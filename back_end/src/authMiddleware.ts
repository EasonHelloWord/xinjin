import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { JwtPayload } from "jsonwebtoken";
import { unauthorized } from "./errors";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

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
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  const sub = typeof decoded === "string" ? undefined : decoded.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw unauthorized("Token subject is missing");
  }

  request.authUserId = sub;
};

