import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authMiddleware } from "./authMiddleware";
import { getDb } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { ChatHistoryItem, generateAssistantReply, toStreamTokens } from "./mockLlm";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const streamMessageSchema = z.object({
  content: z.string().trim().min(1),
  voice: z.boolean().optional(),
  clientMessageId: z.string().trim().min(8).max(128).optional()
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
  client_id?: string | null;
  created_at: number;
};

let messageClientIdColumnAvailable: boolean | null = null;

const ensureMessageClientIdColumn = async (): Promise<boolean> => {
  if (messageClientIdColumnAvailable !== null) return messageClientIdColumnAvailable;
  const db = await getDb();
  const columns = await db.all<{ name: string }[]>(`PRAGMA table_info(messages)`);
  const hasClientId = columns.some((c) => c.name === "client_id");
  if (!hasClientId) {
    try {
      await db.exec(`ALTER TABLE messages ADD COLUMN client_id TEXT`);
      messageClientIdColumnAvailable = true;
      return true;
    } catch {
      messageClientIdColumnAvailable = false;
      return false;
    }
  }
  messageClientIdColumnAvailable = true;
  return true;
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
  const raw = reply.raw as FastifyReply["raw"] & { flush?: () => void };
  if (typeof raw.flush === "function") raw.flush();
};

const randomIntInRange = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomPulse = (): number => Number((0.15 + Math.random() * 0.3).toFixed(3));

const userClientId = (clientMessageId: string): string => `${clientMessageId}:u`;
const assistantClientId = (clientMessageId: string): string => `${clientMessageId}:a`;

const getMessageByClientId = async (sessionId: string, clientId: string): Promise<MessageRow | null> => {
  if (!(await ensureMessageClientIdColumn())) {
    return null;
  }
  const db = await getDb();
  const row = await db.get<MessageRow>(
    `
      SELECT id, session_id, role, content, client_id, created_at
      FROM messages
      WHERE session_id = ? AND client_id = ?
      LIMIT 1
    `,
    sessionId,
    clientId
  );
  return row ?? null;
};

const insertMessage = async (
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  clientId?: string
): Promise<MessageRow> => {
  const db = await getDb();
  const hasClientId = await ensureMessageClientIdColumn();
  if (hasClientId && clientId) {
    const id = randomUUID();
    const createdAt = Date.now();
    await db.run(
      "INSERT OR IGNORE INTO messages (id, session_id, role, content, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      sessionId,
      role,
      content,
      clientId,
      createdAt
    );
    const existing = await getMessageByClientId(sessionId, clientId);
    if (existing) return existing;
  }

  const row: MessageRow = {
    id: randomUUID(),
    session_id: sessionId,
    role,
    content,
    client_id: hasClientId ? clientId ?? null : null,
    created_at: Date.now()
  };
  await db.run(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    row.id,
    row.session_id,
    row.role,
    row.content,
    row.created_at
  );
  return row;
};

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
    url: "/api/chat/sessions/:id/messages",
    preHandler: authMiddleware,
    handler: async (request, _reply: FastifyReply) => {
      const parsed = streamMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }

      const userId = asUserId(request);
      const sessionId = request.params.id;
      await getOwnedSession(sessionId, userId);

      const clientId = parsed.data.clientMessageId?.trim();
      const userCid = clientId ? userClientId(clientId) : undefined;
      const assistantCid = clientId ? assistantClientId(clientId) : undefined;

      const existingAssistant = assistantCid ? await getMessageByClientId(sessionId, assistantCid) : null;
      if (existingAssistant) {
        const existingUser = userCid ? await getMessageByClientId(sessionId, userCid) : null;
        return {
          userMessage: existingUser
            ? {
                id: existingUser.id,
                role: "user" as const,
                content: existingUser.content,
                created_at: existingUser.created_at
              }
            : {
                id: randomUUID(),
                role: "user" as const,
                content: parsed.data.content,
                created_at: existingAssistant.created_at
              },
          assistantMessage: {
            id: existingAssistant.id,
            role: "assistant" as const,
            content: existingAssistant.content,
            created_at: existingAssistant.created_at
          }
        };
      }

      const existingUser = userCid ? await getMessageByClientId(sessionId, userCid) : null;
      const userMessage = existingUser || (await insertMessage(sessionId, "user", parsed.data.content, userCid));

      const history = await getRecentHistory(sessionId, 20);
      const assistantText = await generateAssistantReply(history);
      const assistantMessage = await insertMessage(sessionId, "assistant", assistantText, assistantCid);

      return {
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          content: userMessage.content,
          created_at: userMessage.created_at
        },
        assistantMessage: {
          id: assistantMessage.id,
          role: "assistant" as const,
          content: assistantMessage.content,
          created_at: assistantMessage.created_at
        }
      };
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
      const clientId = parsed.data.clientMessageId?.trim();
      const userCid = clientId ? userClientId(clientId) : undefined;
      const assistantCid = clientId ? assistantClientId(clientId) : undefined;

      const existingAssistant = assistantCid ? await getMessageByClientId(sessionId, assistantCid) : null;
      if (existingAssistant) {
        const tokens = toStreamTokens(existingAssistant.content);
        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("X-Accel-Buffering", "no");
        if (typeof reply.raw.flushHeaders === "function") {
          reply.raw.flushHeaders();
        }
        for (const token of tokens) {
          writeSseEvent(reply, "token", { text: token });
          writeSseEvent(reply, "pulse", { v: randomPulse() });
          await sleep(randomIntInRange(12, 22));
        }
        writeSseEvent(reply, "done", { messageId: existingAssistant.id });
        reply.raw.end();
        return;
      }

      const existingUser = userCid ? await getMessageByClientId(sessionId, userCid) : null;
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }
      writeSseEvent(reply, "pulse", { v: randomPulse() });

      let closed = false;
      request.raw.on("close", () => {
        closed = true;
      });

      try {
        const userMessage = existingUser || (await insertMessage(sessionId, "user", parsed.data.content, userCid));
        const history = await getRecentHistory(sessionId, 20);
        const assistantText = await generateAssistantReply(history);
        const tokens = toStreamTokens(assistantText);

        for (const token of tokens) {
          if (closed || reply.raw.writableEnded) {
            return;
          }

          writeSseEvent(reply, "token", { text: token });
          writeSseEvent(reply, "pulse", { v: randomPulse() });
          await sleep(randomIntInRange(30, 60));
        }

        const assistantMessage = await insertMessage(sessionId, "assistant", assistantText, assistantCid);

        writeSseEvent(reply, "done", { messageId: assistantMessage.id });
        reply.raw.end();
      } catch (err) {
        fastify.log.error({ err }, "SSE stream failed");
        if (!closed && !reply.raw.writableEnded) {
          writeSseEvent(reply, "error", { message: "Stream interrupted" });
          reply.raw.end();
        }
      }
    }
  });
};
