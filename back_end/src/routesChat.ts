import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authMiddleware } from "./authMiddleware";
import { getDb } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { ChatHistoryItem, generateAssistantReply, generateSessionTitle, getSessionTitleRuntimeInfo, toStreamTokens } from "./mockLlm";
import { hasSttConfig, transcribeAudioBase64 } from "./sttService";
import { hasTtsConfig, streamTtsAudio } from "./ttsService";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const streamMessageSchema = z.object({
  content: z.string().trim().min(1),
  voice: z.boolean().optional(),
  thinking: z.boolean().optional(),
  clientMessageId: z.string().trim().min(8).max(128).optional()
});

const voiceTranscribeSchema = z.object({
  audioBase64: z.string().trim().min(8),
  mimeType: z.string().trim().max(100).optional(),
  language: z.string().trim().max(20).optional()
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

const DEFAULT_SESSION_TITLE = "新对话";
const autoTitlingSessions = new Set<string>();
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

const createSession = async (userId: string, title?: string): Promise<SessionRow> => {
  const db = await getDb();
  const session: SessionRow = {
    id: randomUUID(),
    user_id: userId,
    title: title?.trim() || DEFAULT_SESSION_TITLE,
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

const deleteSession = async (sessionId: string): Promise<void> => {
  const db = await getDb();
  await db.run("DELETE FROM messages WHERE session_id = ?", sessionId);
  await db.run("DELETE FROM sessions WHERE id = ?", sessionId);
};

const updateSessionTitle = async (sessionId: string, title: string): Promise<SessionRow | null> => {
  const db = await getDb();
  await db.run("UPDATE sessions SET title = ? WHERE id = ?", title, sessionId);
  const updated = await db.get<SessionRow>(
    "SELECT id, user_id, title, created_at FROM sessions WHERE id = ?",
    sessionId
  );
  return updated ?? null;
};

const toSessionResponse = (session: SessionRow) => ({
  id: session.id,
  title: session.title,
  created_at: session.created_at
});

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

const isDefaultSessionTitle = (title: string): boolean => title.trim() === DEFAULT_SESSION_TITLE;

const canGenerateTitleFromPersistedHistory = (session: SessionRow, history: ChatHistoryItem[]): boolean => {
  if (!isDefaultSessionTitle(session.title)) return false;
  const userCount = history.filter((item) => item.role === "user").length;
  const assistantCount = history.filter((item) => item.role === "assistant").length;
  return userCount >= 1 && assistantCount >= 1;
};

const generatePersistedSessionTitle = async (
  session: SessionRow,
  logger: FastifyInstance["log"]
): Promise<SessionRow> => {
  const { baseUrl, model, hasConfig } = getSessionTitleRuntimeInfo();
  const historyStartedAt = Date.now();
  const history = await getRecentHistory(session.id, 20);
  const historyMs = Date.now() - historyStartedAt;
  const userCount = history.filter((item) => item.role === "user").length;
  const assistantCount = history.filter((item) => item.role === "assistant").length;
  const historyChars = history.reduce((sum, item) => sum + item.content.length, 0);
  const lastUserChars = [...history].reverse().find((item) => item.role === "user")?.content.length ?? 0;
  const lastAssistantChars = [...history].reverse().find((item) => item.role === "assistant")?.content.length ?? 0;

  if (!canGenerateTitleFromPersistedHistory(session, history)) {
    logger.info(
      {
        sessionId: session.id,
        historyMs,
        userCount,
        assistantCount,
        historyChars,
        lastUserChars,
        lastAssistantChars,
        currentTitle: session.title
      },
      "title autogen skipped"
    );
    return session;
  }

  logger.info(
    {
      sessionId: session.id,
      model,
      baseUrl,
      hasConfig,
      historyMs,
      userCount,
      assistantCount,
      historyChars,
      lastUserChars,
      lastAssistantChars
    },
    "title autogen llm started"
  );

  const llmStartedAt = Date.now();
  const nextTitle = (await generateSessionTitle(history)).trim();
  const llmMs = Date.now() - llmStartedAt;
  if (!nextTitle || nextTitle === DEFAULT_SESSION_TITLE) {
    logger.info(
      {
        sessionId: session.id,
        historyMs,
        llmMs,
        userCount,
        assistantCount,
        historyChars,
        lastUserChars,
        lastAssistantChars,
        model,
        baseUrl,
        hasConfig,
        generatedTitleLength: nextTitle.length,
        generatedTitle: nextTitle || ""
      },
      "title autogen produced fallback title"
    );
    return session;
  }

  const saveStartedAt = Date.now();
  const updated = await updateSessionTitle(session.id, nextTitle);
  const saveMs = Date.now() - saveStartedAt;
  logger.info(
    {
      sessionId: session.id,
      historyMs,
      llmMs,
      saveMs,
      totalMs: historyMs + llmMs + saveMs,
      userCount,
      assistantCount,
      historyChars,
      lastUserChars,
      lastAssistantChars,
      model,
      baseUrl,
      hasConfig,
      generatedTitleLength: nextTitle.length,
      generatedTitle: nextTitle
    },
    "title autogen completed"
  );
  return updated ?? session;
};

const setSseHeaders = (request: FastifyRequest, reply: FastifyReply): void => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  reply.raw.statusCode = 200;
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  if (origin) {
    reply.raw.setHeader("Vary", "Origin");
    reply.raw.setHeader("Access-Control-Allow-Origin", origin);
    reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (typeof reply.raw.flushHeaders === "function") {
    reply.raw.flushHeaders();
  }
};

const randomIntInRange = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomPulse = (): number => Number((0.15 + Math.random() * 0.3).toFixed(3));

const userClientId = (clientMessageId: string): string => `${clientMessageId}:u`;
const assistantClientId = (clientMessageId: string): string => `${clientMessageId}:a`;

const streamTtsToSse = async (
  request: FastifyRequest,
  reply: FastifyReply,
  assistantText: string,
  userText?: string
): Promise<void> => {
  if (!hasTtsConfig()) return;
  if (!assistantText.trim()) return;
  if (reply.raw.writableEnded) return;

  writeSseEvent(reply, "tts_start", {
    format: "pcm16",
    sampleRate: 24000
  });

  try {
    const tts = await streamTtsAudio({
      assistantText,
      userText,
      signal: request.raw.aborted ? AbortSignal.abort() : undefined,
      onChunk: async ({ data, seq }) => {
        if (reply.raw.writableEnded) return;
        writeSseEvent(reply, "tts_chunk", {
          audio: data,
          seq,
          format: "pcm16",
          sampleRate: 24000
        });
      }
    });

    if (!reply.raw.writableEnded) {
      writeSseEvent(reply, "tts_end", {
        chunks: tts.emittedChunks,
        style: tts.style,
        sampleRate: tts.sampleRate
      });
    }
  } catch {
    if (!reply.raw.writableEnded) {
      writeSseEvent(reply, "tts_error", { message: "TTS stream failed" });
    }
  }
};

const waitForAssistantByClientId = async (
  sessionId: string,
  clientId: string,
  timeoutMs = 3000
): Promise<MessageRow | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = await getMessageByClientId(sessionId, clientId);
    if (existing) return existing;
    await sleep(150);
  }
  return getMessageByClientId(sessionId, clientId);
};

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
    url: "/api/voice/transcribe",
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, _reply: FastifyReply) => {
      const parsed = voiceTranscribeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }
      if (!hasSttConfig()) {
        throw badRequest("STT_NOT_CONFIGURED", "语音转写服务未配置");
      }

      const normalizedBase64 = parsed.data.audioBase64.replace(/^data:[^;]+;base64,/, "").trim();
      const approxBytes = Math.floor((normalizedBase64.length * 3) / 4);
      if (approxBytes > 5 * 1024 * 1024) {
        throw badRequest("VOICE_TOO_LARGE", "单次语音片段过大，请缩短录音时长");
      }

      try {
        const text = await transcribeAudioBase64({
          audioBase64: parsed.data.audioBase64,
          mimeType: parsed.data.mimeType,
          language: parsed.data.language
        });
        return { text };
      } catch (err) {
        fastify.log.error({ err }, "voice transcribe failed");
        throw badRequest("VOICE_TRANSCRIBE_FAILED", err instanceof Error ? err.message : "语音转写失败");
      }
    }
  });

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
      const session = await createSession(userId, parsed.data.title);
      return {
        sessionId: session.id,
        session: toSessionResponse(session)
      };
    }
  });

  fastify.route({
    method: "GET",
    url: "/api/chat/sessions",
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = asUserId(request);
      const sessions = await getSessionsByUser(userId);
      return sessions.map(toSessionResponse);
    }
  });

  fastify.route<{ Params: { id: string } }>({
    method: "POST",
    url: "/api/chat/sessions/:id/title/autogen",
    preHandler: authMiddleware,
    handler: async (request, _reply: FastifyReply) => {
      const requestStartedAt = Date.now();
      const userId = asUserId(request);
      const sessionId = request.params.id;
      const session = await getOwnedSession(sessionId, userId);
      fastify.log.info({ sessionId, currentTitle: session.title }, "title autogen requested");

      if (autoTitlingSessions.has(sessionId)) {
        const latest = await getOwnedSession(sessionId, userId);
        fastify.log.info(
          {
            sessionId,
            totalMs: Date.now() - requestStartedAt,
            currentTitle: latest.title
          },
          "title autogen deduped"
        );
        return { session: toSessionResponse(latest) };
      }

      autoTitlingSessions.add(sessionId);
      try {
        const updated = await generatePersistedSessionTitle(session, fastify.log);
        fastify.log.info(
          {
            sessionId,
            totalMs: Date.now() - requestStartedAt,
            finalTitle: updated.title
          },
          "title autogen request finished"
        );
        return { session: toSessionResponse(updated) };
      } catch (err) {
        fastify.log.warn({ err, sessionId }, "Failed to auto-title session");
        return { session: toSessionResponse(session) };
      } finally {
        autoTitlingSessions.delete(sessionId);
      }
    }
  });

  fastify.route<{ Params: { id: string } }>({
    method: "DELETE",
    url: "/api/chat/sessions/:id",
    preHandler: authMiddleware,
    handler: async (request, _reply: FastifyReply) => {
      const userId = asUserId(request);
      const sessionId = request.params.id;
      await getOwnedSession(sessionId, userId);
      await deleteSession(sessionId);
      return { ok: true };
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
      const session = await getOwnedSession(sessionId, userId);

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
          },
          session: toSessionResponse(session)
        };
      }

      const existingUser = userCid ? await getMessageByClientId(sessionId, userCid) : null;
      const userMessage = existingUser || (await insertMessage(sessionId, "user", parsed.data.content, userCid));

      const history = await getRecentHistory(sessionId, 20);
      const assistantText = await generateAssistantReply(history, {
        thinkingEnabled: parsed.data.thinking
      });
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
        },
        session: toSessionResponse(session)
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
      const clientId = parsed.data.clientMessageId?.trim();
      const session = await getOwnedSession(sessionId, userId);
      const userCid = clientId ? userClientId(clientId) : undefined;
      const assistantCid = clientId ? assistantClientId(clientId) : undefined;

      const existingAssistant = assistantCid ? await getMessageByClientId(sessionId, assistantCid) : null;
      if (existingAssistant) {
        const tokens = toStreamTokens(existingAssistant.content);
        reply.hijack();
        setSseHeaders(request, reply);
        for (const token of tokens) {
          writeSseEvent(reply, "token", { text: token });
          writeSseEvent(reply, "pulse", { v: randomPulse() });
          await sleep(randomIntInRange(12, 22));
        }
        if (parsed.data.voice) {
          await streamTtsToSse(request, reply, existingAssistant.content, parsed.data.content);
        }
        writeSseEvent(reply, "done", { messageId: existingAssistant.id, sessionTitle: session.title });
        reply.raw.end();
        return;
      }

      const existingUser = userCid ? await getMessageByClientId(sessionId, userCid) : null;
      reply.hijack();
      setSseHeaders(request, reply);
      writeSseEvent(reply, "pulse", { v: randomPulse() });

      let closed = false;
      request.raw.on("close", () => {
        closed = true;
      });

      try {
        const userMessage = existingUser || (await insertMessage(sessionId, "user", parsed.data.content, userCid));
        const history = await getRecentHistory(sessionId, 20);
        let streamedText = "";
        const assistantText = await generateAssistantReply(history, {
          thinkingEnabled: parsed.data.thinking,
          onTextDelta: async (token) => {
            streamedText += token;
            if (closed || reply.raw.writableEnded) {
              return;
            }
            writeSseEvent(reply, "token", { text: token });
            writeSseEvent(reply, "pulse", { v: randomPulse() });
          }
        });
        const finalAssistantText = assistantText || streamedText;
        const assistantMessage = await insertMessage(sessionId, "assistant", finalAssistantText, assistantCid);

        if (closed || reply.raw.writableEnded) {
          return;
        }
        if (parsed.data.voice) {
          await streamTtsToSse(request, reply, finalAssistantText, parsed.data.content);
        }
        writeSseEvent(reply, "done", { messageId: assistantMessage.id, sessionTitle: session.title });
        reply.raw.end();
      } catch (err) {
        fastify.log.error({ err }, "SSE stream failed");
        const recoveredAssistant =
          assistantCid ? await waitForAssistantByClientId(sessionId, assistantCid).catch(() => null) : null;
        if (recoveredAssistant && !closed && !reply.raw.writableEnded) {
          const recoveredSession = await getOwnedSession(sessionId, userId).catch(() => session);
          writeSseEvent(reply, "done", { messageId: recoveredAssistant.id, sessionTitle: recoveredSession.title });
          reply.raw.end();
          return;
        }
        if (!closed && !reply.raw.writableEnded) {
          writeSseEvent(reply, "error", { message: "Stream interrupted" });
          reply.raw.end();
        }
      }
    }
  });
};
