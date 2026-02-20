import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authMiddleware } from "./authMiddleware";
import { getDb } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { ChatHistoryItem, generateMockAssistantReply, toStreamTokens } from "./mockLlm";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const streamMessageSchema = z.object({
  content: z.string().trim().min(1),
  voice: z.boolean().optional()
});

type SessionRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

const asUserId = (request: FastifyRequest): string => {
  if (!request.authUserId) {
    throw forbidden("User is not authenticated");
  }
  return request.authUserId;
};

const getOwnedSession = async (sessionId: string, userId: string): Promise<SessionRow> => {
  const db = await getDb();
  const session = await db.get<SessionRow>(
    "SELECT id, user_id, title, created_at FROM sessions WHERE id = ?",
    sessionId
  );

  if (!session) {
    throw notFound("Session not found");
  }
  if (session.user_id !== userId) {
    throw forbidden("You do not have access to this session");
  }
  return session;
};

const getSessionsByUser = async (userId: string): Promise<SessionRow[]> => {
  const db = await getDb();
  return db.all<SessionRow[]>(
    `
      SELECT id, user_id, title, created_at
      FROM sessions
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
    userId
  );
};

const getOrCreateSingleSession = async (userId: string, title?: string): Promise<SessionRow> => {
  const db = await getDb();
  const sessions = await getSessionsByUser(userId);
  const existing = sessions[0];

  if (existing) {
    if (sessions.length > 1) {
      for (const stale of sessions.slice(1)) {
        await db.run("DELETE FROM sessions WHERE id = ?", stale.id);
      }
    }

    if (title && title.trim() && title.trim() !== existing.title) {
      const nextTitle = title.trim();
      await db.run("UPDATE sessions SET title = ? WHERE id = ?", nextTitle, existing.id);
      return {
        ...existing,
        title: nextTitle
      };
    }

    return existing;
  }

  const session: SessionRow = {
    id: randomUUID(),
    user_id: userId,
    title: title?.trim() || "\u9ed8\u8ba4\u4f1a\u8bdd",
    created_at: Date.now()
  };

  await db.run(
    "INSERT INTO sessions (id, user_id, title, created_at) VALUES (?, ?, ?, ?)",
    session.id,
    session.user_id,
    session.title,
    session.created_at
  );

  return session;
};

const getRecentHistory = async (sessionId: string, limit = 20): Promise<ChatHistoryItem[]> => {
  const db = await getDb();
  const rows = (await db.all(
    `
      SELECT id, session_id, role, content, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    sessionId,
    limit
  )) as MessageRow[];

  return rows.reverse().map((item) => ({
    role: item.role,
    content: item.content
  }));
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const writeSseEvent = (reply: FastifyReply, event: string, data: Record<string, unknown>): void => {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
};

const randomIntInRange = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomPulse = (): number => Number((0.15 + Math.random() * 0.3).toFixed(3));

export const registerChatRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.route({
    method: "POST",
    url: "/api/chat/sessions",
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, _reply: FastifyReply) => {
      const parsed = createSessionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }

      const userId = asUserId(request);
      const session = await getOrCreateSingleSession(userId, parsed.data.title);
      return { sessionId: session.id };
    }
  });

  fastify.route({
    method: "GET",
    url: "/api/chat/sessions",
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = asUserId(request);
      const session = await getOrCreateSingleSession(userId);
      return [
        {
          id: session.id,
          title: session.title,
          created_at: session.created_at
        }
      ];
    }
  });

  fastify.route<{ Params: { id: string } }>({
    method: "GET",
    url: "/api/chat/sessions/:id/messages",
    preHandler: authMiddleware,
    handler: async (request, _reply: FastifyReply) => {
      const userId = asUserId(request);
      const sessionId = request.params.id;
      await getOwnedSession(sessionId, userId);

      const db = await getDb();
      const messages = (await db.all(
        `
          SELECT id, session_id, role, content, created_at
          FROM messages
          WHERE session_id = ?
          ORDER BY created_at ASC
        `,
        sessionId
      )) as MessageRow[];

      return messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at
      }));
    }
  });

  fastify.route<{ Params: { id: string } }>({
    method: "DELETE",
    url: "/api/chat/sessions/:id/messages",
    preHandler: authMiddleware,
    handler: async (request, _reply: FastifyReply) => {
      const userId = asUserId(request);
      const sessionId = request.params.id;
      await getOwnedSession(sessionId, userId);

      const db = await getDb();
      await db.run("DELETE FROM messages WHERE session_id = ?", sessionId);
      return { ok: true };
    }
  });

  fastify.route<{ Params: { id: string } }>({
    method: "POST",
    url: "/api/chat/sessions/:id/stream",
    preHandler: authMiddleware,
    handler: async (request, reply: FastifyReply) => {
      const parsed = streamMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }

      const userId = asUserId(request);
      const sessionId = request.params.id;
      await getOwnedSession(sessionId, userId);
      const db = await getDb();

      const userMessageId = randomUUID();
      await db.run(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        userMessageId,
        sessionId,
        "user",
        parsed.data.content,
        Date.now()
      );

      const history = await getRecentHistory(sessionId, 20);
      const assistantText = generateMockAssistantReply(history);
      const tokens = toStreamTokens(assistantText);

      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }

      let closed = false;
      request.raw.on("close", () => {
        closed = true;
      });

      for (const token of tokens) {
        if (closed || reply.raw.writableEnded) {
          return;
        }

        writeSseEvent(reply, "token", { text: token });
        writeSseEvent(reply, "pulse", { v: randomPulse() });
        await sleep(randomIntInRange(30, 60));
      }

      const messageId = randomUUID();
      await db.run(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        messageId,
        sessionId,
        "assistant",
        assistantText,
        Date.now()
      );

      writeSseEvent(reply, "done", { messageId });
      reply.raw.end();
    }
  });
};
