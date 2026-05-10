import type { FastifyReply, FastifyRequest } from "fastify";
import { createPublicKey, randomUUID, type JsonWebKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { getDb } from "./db";
import { unauthorized } from "./errors";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const OIDC_ISSUER = (process.env.OIDC_ISSUER || "https://auth.easonjan.top").replace(/\/+$/, "");
const OIDC_JWKS_URI = process.env.OIDC_JWKS_URI || `${OIDC_ISSUER}/.well-known/jwks.json`;
const OIDC_USERINFO_URI = process.env.OIDC_USERINFO_URI || `${OIDC_ISSUER}/oauth/userinfo`;
const ACCESS_TOKEN_AUDIENCE = process.env.ACCESS_TOKEN_AUDIENCE || "api.easonjan.top";

type JwksKey = JsonWebKey & { kid?: string; alg?: string; use?: string };
type UserInfo = {
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
};

let jwksCache: { keys: JwksKey[]; expiresAt: number } | null = null;

declare module "fastify" {
  interface FastifyRequest {
    authUserId?: string;
  }
}

export const signAuthToken = (userId: string): string =>
  jwt.sign({}, JWT_SECRET, {
    subject: userId,
    expiresIn: "7d"
  });

const verifyLegacyToken = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sub = typeof decoded === "string" ? undefined : decoded.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
};

const verifyOidcAccessToken = async (token: string): Promise<string | null> => {
  const db = await getDb();
  const keys = await db.all<{ private_key_pem: string }[]>(
    "SELECT private_key_pem FROM oidc_keys ORDER BY created_at DESC"
  );

  for (const key of keys) {
    try {
      const publicKey = createPublicKey(key.private_key_pem).export({ format: "pem", type: "spki" }).toString();
      const decoded = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: OIDC_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE
      });
      const sub = typeof decoded === "string" ? undefined : decoded.sub;
      return typeof sub === "string" && sub.length > 0 ? sub : null;
    } catch {
      // Try the next active signing key.
    }
  }

  return null;
};

const loadRemoteJwks = async (): Promise<JwksKey[]> => {
  if (jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }

  const res = await fetch(OIDC_JWKS_URI);
  if (!res.ok) {
    throw new Error(`JWKS request failed: ${res.status}`);
  }
  const payload = (await res.json()) as { keys?: JwksKey[] };
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  jwksCache = {
    keys,
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  return keys;
};

const verifyRemoteOidcAccessToken = async (token: string): Promise<string | null> => {
  const decodedHeader = jwt.decode(token, { complete: true });
  const kid = decodedHeader && typeof decodedHeader === "object" ? decodedHeader.header.kid : undefined;
  const keys = await loadRemoteJwks();

  for (const key of keys) {
    if (kid && key.kid !== kid) continue;
    try {
      const publicKey = createPublicKey({ key, format: "jwk" }).export({ format: "pem", type: "spki" }).toString();
      const decoded = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: OIDC_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE
      });
      const sub = typeof decoded === "string" ? undefined : decoded.sub;
      return typeof sub === "string" && sub.length > 0 ? sub : null;
    } catch {
      // Try the next matching public key.
    }
  }

  return null;
};

const loadUserInfo = async (token: string): Promise<UserInfo | null> => {
  try {
    const res = await fetch(OIDC_USERINFO_URI, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) return null;
    return (await res.json()) as UserInfo;
  } catch {
    return null;
  }
};

const ensureBusinessUser = async (userId: string, token: string): Promise<void> => {
  const db = await getDb();
  const existing = await db.get<{ id: string }>("SELECT id FROM users WHERE id = ? LIMIT 1", userId);
  if (existing) return;

  const userInfo = await loadUserInfo(token);
  const email =
    userInfo?.email ||
    (userInfo?.preferred_username ? `${userInfo.preferred_username}@oidc.local` : `${userId}@oidc.local`);
  await db.run(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    userId,
    email.trim().toLowerCase(),
    `oidc:${randomUUID()}`,
    Date.now()
  );
};

const getBearerToken = (header: string | undefined): string => {
  if (!header) {
    throw unauthorized("Missing Authorization header");
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw unauthorized("Authorization must use Bearer token");
  }
  return token;
};

export const authMiddleware = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  const token = getBearerToken(request.headers.authorization);
  const sub = verifyLegacyToken(token) || (await verifyOidcAccessToken(token)) || (await verifyRemoteOidcAccessToken(token));
  if (!sub) throw unauthorized("Invalid or expired token");

  await ensureBusinessUser(sub, token);

  request.authUserId = sub;
};
