import { getAuthToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

type ApiErrorPayload = { error?: { code?: string; message?: string } };

const toErrorMessage = (fallback: string, payload: unknown): string => {
  if (!payload || typeof payload !== "object") return fallback;
  const typed = payload as ApiErrorPayload;
  return typed.error?.message || fallback;
};

const request = async <T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean; rawText?: boolean }
): Promise<T> => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;

  if (hasBody && !headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (!init?.skipAuth && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!res.ok) {
    let payload: unknown = undefined;
    try {
      payload = await res.json();
    } catch {
      // ignore non-json error body
    }
    throw new Error(toErrorMessage(`Request failed (${res.status})`, payload));
  }

  if (init?.rawText) {
    return (await res.text()) as T;
  }
  return (await res.json()) as T;
};

export interface AuthUser {
  id: string;
  email: string;
  createdAt: number;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

type SSEHandlers = {
  onToken?: (text: string) => void;
  onPulse?: (v: number) => void;
  onDone?: (messageId: string) => void;
};

type SseEvent = {
  event: string;
  data: string;
};

const dispatchSseEvent = (evt: SseEvent, handlers: SSEHandlers): void => {
  if (!evt.data) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(evt.data);
  } catch {
    return;
  }

  if (evt.event === "token") {
    const text = (parsed as { text?: unknown }).text;
    if (typeof text === "string") handlers.onToken?.(text);
    return;
  }

  if (evt.event === "pulse") {
    const v = (parsed as { v?: unknown }).v;
    if (typeof v === "number") handlers.onPulse?.(v);
    return;
  }

  if (evt.event === "done") {
    const messageId = (parsed as { messageId?: unknown }).messageId;
    if (typeof messageId === "string") handlers.onDone?.(messageId);
  }
};

export const parseSSE = async (
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const emit = (): void => {
    if (dataLines.length === 0) return;
    dispatchSseEvent({ event: eventName, data: dataLines.join("\n") }, handlers);
    eventName = "message";
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        emit();
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.length) {
    const lines = buffer.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      } else if (line === "") {
        emit();
      }
    }
  }
  emit();
};

export const api = {
  register: (email: string, password: string): Promise<AuthResponse> =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true
    }),

  login: (email: string, password: string): Promise<AuthResponse> =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true
    }),

  createSession: async (title?: string): Promise<{ sessionId: string }> =>
    request<{ sessionId: string }>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {})
    }),

  listSessions: (): Promise<ChatSession[]> => request<ChatSession[]>("/api/chat/sessions"),

  getMessages: (sessionId: string): Promise<ChatMessage[]> =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),

  clearMessages: (sessionId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/chat/sessions/${sessionId}/messages`, {
      method: "DELETE"
    }),

  streamMessage: async (
    sessionId: string,
    content: string,
    options: { voice?: boolean },
    handlers: SSEHandlers
  ): Promise<void> => {
    const token = getAuthToken();
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, voice: Boolean(options.voice) })
    });

    if (!res.ok) {
      let payload: unknown = undefined;
      try {
        payload = await res.json();
      } catch {
        // ignore non-json error body
      }
      throw new Error(toErrorMessage(`Stream request failed (${res.status})`, payload));
    }

    if (!res.body) {
      throw new Error("SSE stream body is empty");
    }

    await parseSSE(res.body, handlers);
  }
};
