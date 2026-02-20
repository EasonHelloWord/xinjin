import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "./db";
import { signAuthToken } from "./authMiddleware";
import { badRequest } from "./errors";

const authBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

type UserRow = {
  id: string;
  email: string;
  created_at: number;
};

const sanitizeEmail = (email: string): string => email.trim().toLowerCase();

const toUserResponse = (user: UserRow): { id: string; email: string; createdAt: number } => ({
  id: user.id,
  email: user.email,
  createdAt: user.created_at
});

export const registerAuthRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.post("/api/auth/register", async (request) => {
    const parsed = authBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
    }

    const db = await getDb();
    const email = sanitizeEmail(parsed.data.email);
    const existing = await db.get<UserRow>("SELECT id, email, created_at FROM users WHERE email = ?", email);
    if (existing) {
      throw badRequest("EMAIL_EXISTS", "Email already registered");
    }

    const id = randomUUID();
    const createdAt = Date.now();
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    await db.run(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      id,
      email,
      passwordHash,
      createdAt
    );

    const token = signAuthToken(id);
    return {
      token,
      user: {
        id,
        email,
        createdAt
      }
    };
  });

  fastify.post("/api/auth/login", async (request) => {
    const parsed = authBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
    }

    const db = await getDb();
    const email = sanitizeEmail(parsed.data.email);
    const user = await db.get<UserRow & { password_hash: string }>(
      "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
      email
    );
    if (!user) {
      throw badRequest("INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    const passwordOk = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!passwordOk) {
      throw badRequest("INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    const token = signAuthToken(user.id);
    return {
      token,
      user: toUserResponse(user)
    };
  });
};

