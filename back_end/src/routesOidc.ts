import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  createPublicKey,
  type JsonWebKey
} from "node:crypto";
import { z } from "zod";
import { getDb } from "./db";

const ISSUER = (process.env.OIDC_ISSUER || "https://auth.easonjan.top").replace(/\/+$/, "");
const ACCESS_TOKEN_AUDIENCE = process.env.ACCESS_TOKEN_AUDIENCE || "api.easonjan.top";
const COOKIE_NAME = process.env.OIDC_COOKIE_NAME || "xinjin_oidc_sid";
const CORS_ORIGINS = (process.env.OIDC_CORS_ORIGINS || "https://tools.easonjan.top")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const SESSION_TTL_MS = Number(process.env.OIDC_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const CODE_TTL_MS = Number(process.env.OIDC_CODE_TTL_MS || 5 * 60 * 1000);
const ACCESS_TTL_SECONDS = Number(process.env.OIDC_ACCESS_TTL_SECONDS || 3600);
const ID_TTL_SECONDS = Number(process.env.OIDC_ID_TTL_SECONDS || 3600);
const REFRESH_TTL_MS = Number(process.env.OIDC_REFRESH_TTL_MS || 30 * 24 * 60 * 60 * 1000);

type ClientRow = {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  scopes: string;
  created_at: number;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
};

type KeyRow = {
  kid: string;
  private_key_pem: string;
  public_jwk_json: string;
  created_at: number;
};

type AuthCodeRow = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  nonce: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  consumed_at: number | null;
};

type RefreshTokenRow = {
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: number;
  revoked_at: number | null;
};

const formParser = (_request: FastifyRequest, payload: NodeJS.ReadableStream, done: (err: Error | null, body?: unknown) => void) => {
  let body = "";
  payload.setEncoding("utf8");
  payload.on("data", (chunk) => {
    body += chunk;
  });
  payload.on("end", () => {
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });
  payload.on("error", (err) => done(err));
};

const base64url = (input: Buffer): string =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const codeChallengeFor = (verifier: string): string => base64url(createHash("sha256").update(verifier).digest());
const randomToken = (bytes = 32): string => base64url(randomBytes(bytes));
const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const parseJsonArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const sendOAuthError = (
  reply: FastifyReply,
  statusCode: number,
  error: string,
  description?: string
): FastifyReply =>
  reply.status(statusCode).send({
    error,
    ...(description ? { error_description: description } : {})
  });

const isAllowedCorsOrigin = (origin: string): boolean =>
  CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin);

const applyOidcCors = (request: FastifyRequest, reply: FastifyReply): void => {
  const origin = request.headers.origin;
  if (!origin || !isAllowedCorsOrigin(origin)) return;
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  reply.header("Access-Control-Max-Age", "86400");
  reply.header("Vary", "Origin");
};

const html = (body: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>统一身份认证</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17202a; }
    main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e1e5ea; border-radius: 8px; padding: 28px; box-shadow: 0 12px 32px rgba(15, 23, 42, .08); }
    h1 { margin: 0 0 20px; font-size: 22px; }
    label { display: block; margin: 14px 0 6px; font-size: 14px; color: #4b5563; }
    input { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 15px; }
    button { width: 100%; margin-top: 20px; padding: 11px 12px; border: 0; border-radius: 6px; background: #1f6feb; color: #fff; font-size: 15px; cursor: pointer; }
    a { color: #1f6feb; text-decoration: none; }
    p { margin: 16px 0 0; color: #4b5563; font-size: 14px; }
    .error { margin-bottom: 12px; padding: 10px 12px; border-radius: 6px; background: #fff1f2; color: #be123c; }
  </style>
</head>
<body>${body}</body>
</html>`;

const getCookie = (request: FastifyRequest, name: string): string | null => {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
};

const setSessionCookie = (reply: FastifyReply, sid: string, expiresAt: number): void => {
  const secure = ISSUER.startsWith("https://");
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`
  );
};

const clearSessionCookie = (reply: FastifyReply): void => {
  const secure = ISSUER.startsWith("https://");
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`
  );
};

const getCurrentUserId = async (request: FastifyRequest): Promise<string | null> => {
  const sid = getCookie(request, COOKIE_NAME);
  if (!sid) return null;
  const db = await getDb();
  const row = await db.get<{ user_id: string }>(
    "SELECT user_id FROM oidc_web_sessions WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    sha256(sid),
    Date.now()
  );
  return row?.user_id || null;
};

const createWebSession = async (reply: FastifyReply, userId: string): Promise<void> => {
  const db = await getDb();
  const sid = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.run(
    "INSERT INTO oidc_web_sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    sha256(sid),
    userId,
    expiresAt,
    now
  );
  setSessionCookie(reply, sid, expiresAt);
};

const getSigningKey = async (): Promise<KeyRow> => {
  const db = await getDb();
  const existing = await db.get<KeyRow>("SELECT kid, private_key_pem, public_jwk_json, created_at FROM oidc_keys ORDER BY created_at DESC LIMIT 1");
  if (existing) return existing;

  const kid = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const publicJwk = { ...jwk, kid, use: "sig", alg: "RS256" };
  await db.run(
    "INSERT INTO oidc_keys (kid, private_key_pem, public_jwk_json, created_at) VALUES (?, ?, ?, ?)",
    kid,
    privateKeyPem,
    JSON.stringify(publicJwk),
    Date.now()
  );
  return { kid, private_key_pem: privateKeyPem, public_jwk_json: JSON.stringify(publicJwk), created_at: Date.now() };
};

const signToken = async (
  claims: Record<string, unknown>,
  subject: string,
  audience: string,
  expiresInSeconds: number
): Promise<string> => {
  const key = await getSigningKey();
  return jwt.sign(claims, key.private_key_pem, {
    algorithm: "RS256",
    keyid: key.kid,
    issuer: ISSUER,
    subject,
    audience,
    expiresIn: expiresInSeconds,
    jwtid: randomUUID()
  });
};

const loadClient = async (clientId: string): Promise<ClientRow | null> => {
  const db = await getDb();
  const client = await db.get<ClientRow>(
    "SELECT client_id, client_name, redirect_uris_json, scopes, created_at FROM oidc_clients WHERE client_id = ?",
    clientId
  );
  return client || null;
};

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  return_to: z.string().optional()
});

const clientBodySchema = z.object({
  client_id: z.string().min(1),
  client_name: z.string().min(1).optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  scopes: z.string().optional()
});

const getReturnTo = (request: FastifyRequest): string => {
  const url = new URL(request.url, ISSUER);
  const returnTo = url.searchParams.get("return_to") || "/";
  return returnTo.startsWith("/") ? returnTo : "/";
};

const renderLogin = (mode: "login" | "register", returnTo: string, message = ""): string => {
  const action = mode === "login" ? "/login" : "/register";
  const title = mode === "login" ? "登录统一身份认证" : "注册统一身份认证";
  const switchHref = `${mode === "login" ? "/register" : "/login"}?return_to=${encodeURIComponent(returnTo)}`;
  const switchText = mode === "login" ? "没有账号？注册" : "已有账号？登录";
  return html(`<main>
    <h1>${title}</h1>
    ${message ? `<div class="error">${message}</div>` : ""}
    <form method="post" action="${action}">
      <input type="hidden" name="return_to" value="${returnTo.replace(/"/g, "&quot;")}" />
      <label>邮箱</label>
      <input name="email" type="email" autocomplete="email" required />
      <label>密码</label>
      <input name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="8" required />
      <button type="submit">${mode === "login" ? "登录" : "注册"}</button>
    </form>
    <p><a href="${switchHref}">${switchText}</a></p>
  </main>`);
};

const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean => {
  const expected = process.env.OIDC_ADMIN_TOKEN;
  if (!expected && process.env.NODE_ENV !== "production") return true;
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (expected && token === expected) return true;
  sendOAuthError(reply, 401, "unauthorized", "Admin token required");
  return false;
};

export const registerOidcRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.addContentTypeParser("application/x-www-form-urlencoded", formParser);

  fastify.addHook("onRequest", async (request, reply) => {
    if (
      request.url.startsWith("/oauth/") ||
      request.url.startsWith("/.well-known/") ||
      request.url.startsWith("/admin/clients")
    ) {
      applyOidcCors(request, reply);
    }
  });

  const preflight = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    applyOidcCors(request, reply);
    reply.status(204).send();
  };

  fastify.options("/oauth/token", preflight);
  fastify.options("/oauth/userinfo", preflight);
  fastify.options("/oauth/revoke", preflight);
  fastify.options("/admin/clients", preflight);
  fastify.options("/.well-known/openid-configuration", preflight);
  fastify.options("/.well-known/jwks.json", preflight);

  fastify.get("/.well-known/openid-configuration", async () => ({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "email", "email_verified", "name", "preferred_username", "picture"]
  }));

  fastify.get("/.well-known/jwks.json", async () => {
    const key = await getSigningKey();
    return { keys: [JSON.parse(key.public_jwk_json)] };
  });

  fastify.get("/login", async (request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderLogin("login", getReturnTo(request)));
  });

  fastify.post("/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.type("text/html; charset=utf-8").status(400).send(renderLogin("login", "/", "请输入有效的邮箱和密码。"));
      return;
    }
    const db = await getDb();
    const user = await db.get<UserRow>(
      "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
      normalizeEmail(parsed.data.email)
    );
    const ok = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!user || !ok) {
      reply.type("text/html; charset=utf-8").status(401).send(renderLogin("login", parsed.data.return_to || "/", "邮箱或密码错误。"));
      return;
    }
    await createWebSession(reply, user.id);
    reply.redirect(parsed.data.return_to || "/");
  });

  fastify.get("/register", async (request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderLogin("register", getReturnTo(request)));
  });

  fastify.post("/register", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.type("text/html; charset=utf-8").status(400).send(renderLogin("register", "/", "请输入有效的邮箱和至少 8 位密码。"));
      return;
    }
    const db = await getDb();
    const email = normalizeEmail(parsed.data.email);
    const existing = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
    if (existing) {
      reply.type("text/html; charset=utf-8").status(409).send(renderLogin("register", parsed.data.return_to || "/", "该邮箱已注册。"));
      return;
    }
    const id = randomUUID();
    await db.run(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      id,
      email,
      await bcrypt.hash(parsed.data.password, 10),
      Date.now()
    );
    await createWebSession(reply, id);
    reply.redirect(parsed.data.return_to || "/");
  });

  fastify.post("/logout", async (request, reply) => {
    const sid = getCookie(request, COOKIE_NAME);
    if (sid) {
      const db = await getDb();
      await db.run("UPDATE oidc_web_sessions SET revoked_at = ? WHERE id_hash = ?", Date.now(), sha256(sid));
    }
    clearSessionCookie(reply);
    reply.send({ ok: true });
  });

  fastify.get("/oauth/authorize", async (request, reply) => {
    const url = new URL(request.url, ISSUER);
    const responseType = url.searchParams.get("response_type");
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const scope = url.searchParams.get("scope") || "openid";
    const state = url.searchParams.get("state") || "";
    const nonce = url.searchParams.get("nonce");
    const challenge = url.searchParams.get("code_challenge") || "";
    const challengeMethod = url.searchParams.get("code_challenge_method") || "";

    const client = await loadClient(clientId);
    const allowedRedirects = client ? parseJsonArray(client.redirect_uris_json) : [];
    if (!client || responseType !== "code" || !allowedRedirects.includes(redirectUri)) {
      return sendOAuthError(reply, 400, "invalid_request", "Invalid client, response_type, or redirect_uri");
    }
    if (!scope.split(/\s+/).includes("openid") || !challenge || challengeMethod !== "S256") {
      return sendOAuthError(reply, 400, "invalid_request", "openid scope and PKCE S256 are required");
    }

    const prompt = url.searchParams.get("prompt");
    if (prompt === "login") {
      const sid = getCookie(request, COOKIE_NAME);
      if (sid) {
        const db = await getDb();
        await db.run("UPDATE oidc_web_sessions SET revoked_at = ? WHERE id_hash = ?", Date.now(), sha256(sid));
      }
      clearSessionCookie(reply);
      reply.redirect(`/login?return_to=${encodeURIComponent(request.url.replace(/prompt=login&?/, ""))}`);
      return;
    }

    const userId = await getCurrentUserId(request);
    if (!userId) {
      reply.redirect(`/login?return_to=${encodeURIComponent(request.url)}`);
      return;
    }

    const code = randomToken();
    const now = Date.now();
    const db = await getDb();
    await db.run(
      `INSERT INTO oidc_authorization_codes
        (code_hash, client_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sha256(code),
      clientId,
      userId,
      redirectUri,
      scope,
      nonce,
      challenge,
      challengeMethod,
      now + CODE_TTL_MS,
      now
    );

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    if (state) callback.searchParams.set("state", state);
    reply.redirect(callback.toString());
  });

  fastify.post("/oauth/token", async (request, reply) => {
    const body = z
      .object({
        grant_type: z.enum(["authorization_code", "refresh_token"]),
        client_id: z.string().min(1),
        redirect_uri: z.string().optional(),
        code: z.string().optional(),
        code_verifier: z.string().optional(),
        refresh_token: z.string().optional()
      })
      .safeParse(request.body);
    if (!body.success) return sendOAuthError(reply, 400, "invalid_request");

    const db = await getDb();
    const client = await loadClient(body.data.client_id);
    if (!client) return sendOAuthError(reply, 400, "invalid_client");

    let userId: string;
    let scope: string;
    let nonce: string | null = null;

    if (body.data.grant_type === "authorization_code") {
      if (!body.data.code || !body.data.redirect_uri || !body.data.code_verifier) {
        return sendOAuthError(reply, 400, "invalid_request");
      }
      const code = await db.get<AuthCodeRow>(
        `SELECT client_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, consumed_at
         FROM oidc_authorization_codes WHERE code_hash = ?`,
        sha256(body.data.code)
      );
      if (
        !code ||
        code.client_id !== body.data.client_id ||
        code.redirect_uri !== body.data.redirect_uri ||
        code.consumed_at ||
        code.expires_at <= Date.now() ||
        code.code_challenge !== codeChallengeFor(body.data.code_verifier)
      ) {
        return sendOAuthError(reply, 400, "invalid_grant");
      }
      await db.run("UPDATE oidc_authorization_codes SET consumed_at = ? WHERE code_hash = ?", Date.now(), sha256(body.data.code));
      userId = code.user_id;
      scope = code.scope;
      nonce = code.nonce;
    } else {
      if (!body.data.refresh_token) return sendOAuthError(reply, 400, "invalid_request");
      const refresh = await db.get<RefreshTokenRow>(
        "SELECT client_id, user_id, scope, expires_at, revoked_at FROM oidc_refresh_tokens WHERE token_hash = ?",
        sha256(body.data.refresh_token)
      );
      if (
        !refresh ||
        refresh.client_id !== body.data.client_id ||
        refresh.revoked_at ||
        refresh.expires_at <= Date.now()
      ) {
        return sendOAuthError(reply, 400, "invalid_grant");
      }
      userId = refresh.user_id;
      scope = refresh.scope;
    }

    const user = await db.get<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = ?", userId);
    if (!user) return sendOAuthError(reply, 400, "invalid_grant");

    const refreshToken = randomToken(48);
    await db.run(
      "INSERT INTO oidc_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      sha256(refreshToken),
      body.data.client_id,
      userId,
      scope,
      Date.now() + REFRESH_TTL_MS,
      Date.now()
    );

    const idClaims = {
      email: user.email,
      email_verified: false,
      name: user.email.split("@")[0],
      preferred_username: user.email.split("@")[0],
      ...(nonce ? { nonce } : {})
    };
    const accessClaims = { scope };
    return {
      access_token: await signToken(accessClaims, userId, ACCESS_TOKEN_AUDIENCE, ACCESS_TTL_SECONDS),
      id_token: await signToken(idClaims, userId, body.data.client_id, ID_TTL_SECONDS),
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      scope
    };
  });

  fastify.get("/oauth/userinfo", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return sendOAuthError(reply, 401, "invalid_token");
    const key = await getSigningKey();
    const publicKey = createPublicKey(key.private_key_pem).export({ format: "pem", type: "spki" }).toString();
    let decoded: jwt.JwtPayload | string;
    try {
      decoded = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE
      });
    } catch {
      return sendOAuthError(reply, 401, "invalid_token");
    }
    const sub = typeof decoded === "string" ? "" : decoded.sub;
    if (!sub) return sendOAuthError(reply, 401, "invalid_token");
    const db = await getDb();
    const user = await db.get<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = ?", sub);
    if (!user) return sendOAuthError(reply, 404, "not_found");
    const username = user.email.split("@")[0];
    return {
      sub: user.id,
      email: user.email,
      email_verified: false,
      name: username,
      preferred_username: username,
      picture: null
    };
  });

  fastify.post("/oauth/revoke", async (request, reply) => {
    const body = z.object({ client_id: z.string().min(1), token: z.string().min(1), token_type_hint: z.string().optional() }).safeParse(request.body);
    if (!body.success) return sendOAuthError(reply, 400, "invalid_request");
    const db = await getDb();
    await db.run(
      "UPDATE oidc_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL",
      Date.now(),
      sha256(body.data.token),
      body.data.client_id
    );
    reply.status(200).send({});
  });

  fastify.get("/admin/clients", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const db = await getDb();
    const rows = await db.all<ClientRow[]>("SELECT client_id, client_name, redirect_uris_json, scopes, created_at FROM oidc_clients ORDER BY created_at DESC");
    return rows.map((row) => ({
      client_id: row.client_id,
      client_name: row.client_name,
      redirect_uris: parseJsonArray(row.redirect_uris_json),
      scopes: row.scopes,
      created_at: row.created_at
    }));
  });

  fastify.post("/admin/clients", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = clientBodySchema.safeParse(request.body);
    if (!parsed.success) return sendOAuthError(reply, 400, "invalid_request", parsed.error.message);
    const db = await getDb();
    await db.run(
      `INSERT INTO oidc_clients (client_id, client_name, redirect_uris_json, scopes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         client_name = excluded.client_name,
         redirect_uris_json = excluded.redirect_uris_json,
         scopes = excluded.scopes`,
      parsed.data.client_id,
      parsed.data.client_name || parsed.data.client_id,
      JSON.stringify(parsed.data.redirect_uris),
      parsed.data.scopes || "openid profile email",
      Date.now()
    );
    reply.status(201).send({ ok: true });
  });
};
