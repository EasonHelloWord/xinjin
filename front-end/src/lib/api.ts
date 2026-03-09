import { getAuthToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8787";

type ApiErrorPayload = { error?: { code?: string; message?: string } };

const toErrorMessage = (fallback: string, payload: unknown): string => {
  if (!payload || typeof payload !== "object") return fallback;
  const typed = payload as ApiErrorPayload;
  return typed.error?.message || fallback;
};

const withHostFallback = (base: string): string[] => {
  const set = new Set<string>([base]);
  if (base.includes("localhost")) {
    set.add(base.replace("localhost", "127.0.0.1"));
  }
  if (base.includes("127.0.0.1")) {
    set.add(base.replace("127.0.0.1", "localhost"));
  }
  return Array.from(set);
};

const fetchWithFallback = async (path: string, init: RequestInit, base = API_BASE): Promise<Response> => {
  const candidates = withHostFallback(base);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return await fetch(`${candidate}${path}`, init);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed");
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

  let res: Response;
  try {
    res = await fetchWithFallback(path, {
      ...init,
      headers
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network request failed";
    throw new Error(`Network error: ${message}. API_BASE=${API_BASE}`);
  }

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

export type UserLevel = "healthy" | "mild" | "moderate" | "severe";
export type StateType = "sensory_overload" | "emotional_block" | "mixed_fluctuation";

export interface AssessmentSectionScores {
  emotion: number;
  selfAndRelation: number;
  bodyAndVitality: number;
  meaningAndHope: number;
}

export interface AdviceConfidence {
  state: number;
  tcm: number;
  western: number;
}

export interface AssessmentResult {
  id: string;
  score: number;
  level: UserLevel;
  sectionScores?: AssessmentSectionScores | null;
  createdAt: number;
}

export interface AnalysisResult {
  id: string;
  assessmentId: string | null;
  score: number | null;
  level: UserLevel;
  emotionTags: string[];
  contradictions: string[];
  summary: string;
  stateType: StateType;
  tcmAdvice: string[];
  westernAdvice: string[];
  microTasks: string[];
  confidence?: AdviceConfidence | null;
  riskNotice?: string | null;
  createdAt: number;
}

export interface ProfileSummary {
  latestAssessment: (AssessmentResult & { answers: number[] }) | null;
  latestAnalysis: (AnalysisResult & { inputText: string }) | null;
}

export interface ProfileTimeline {
  assessments: Array<AssessmentResult & { answers: number[] }>;
  analyses: Array<AnalysisResult & { inputText: string }>;
}

type SSEHandlers = {
  onToken?: (text: string) => void;
  onPulse?: (v: number) => void;
  onDone?: (messageId: string) => void;
  onError?: (message: string) => void;
};

type SendOptions = {
  voice?: boolean;
  clientMessageId?: string;
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
    return;
  }

  if (evt.event === "error") {
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string") {
      handlers.onError?.(message);
    } else {
      handlers.onError?.("Stream error");
    }
  }
};

const parseSseFrame = (rawFrame: string): SseEvent | null => {
  const lines = rawFrame.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;
  return {
    event: eventName,
    data: dataLines.join("\n")
  };
};

const consumeSSE = async (
  stream: ReadableStream<Uint8Array>,
  handlers: SSEHandlers
): Promise<{ doneReceived: boolean; tokenCount: number }> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneReceived = false;
  let tokenCount = 0;

  while (true) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      next = await reader.read();
    } catch {
      throw new Error("Stream interrupted");
    }
    const { value, done } = next;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const evt = parseSseFrame(frame);
      if (!evt) continue;
      if (evt.event === "token") tokenCount += 1;
      if (evt.event === "done") doneReceived = true;
      dispatchSseEvent(evt, handlers);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const evt = parseSseFrame(buffer);
    if (evt) {
      if (evt.event === "token") tokenCount += 1;
      if (evt.event === "done") doneReceived = true;
      dispatchSseEvent(evt, handlers);
    }
  }

  return { doneReceived, tokenCount };
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

  sendMessageOnce: (
    sessionId: string,
    content: string,
    options: SendOptions
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> =>
    request<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(`/api/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        voice: Boolean(options.voice),
        clientMessageId: options.clientMessageId
      })
    }),

  streamMessage: async (
    sessionId: string,
    content: string,
    options: SendOptions,
    handlers: SSEHandlers
  ): Promise<void> => {
    const token = getAuthToken();
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 60_000);

    let res: Response;
    try {
      res = await fetchWithFallback(`/api/chat/sessions/${sessionId}/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          voice: Boolean(options.voice),
          clientMessageId: options.clientMessageId
        }),
        signal: ac.signal
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network request failed";
      window.clearTimeout(timeout);
      throw new Error(`Network error: ${message}. API_BASE=${API_BASE}`);
    }

    if (!res.ok) {
      let payload: unknown = undefined;
      let textBody = "";
      try {
        payload = await res.json();
      } catch {
        try {
          textBody = await res.text();
        } catch {
          // ignore non-json error body
        }
      }
      const message = toErrorMessage(`Stream request failed (${res.status})`, payload);
      window.clearTimeout(timeout);
      throw new Error(textBody ? `${message}: ${textBody}` : message);
    }

    if (!res.body) {
      window.clearTimeout(timeout);
      throw new Error("SSE stream body is empty");
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      window.clearTimeout(timeout);
      throw new Error(`Unexpected stream content-type: ${contentType || "unknown"}`);
    }

    const { doneReceived } = await consumeSSE(res.body, handlers);
    window.clearTimeout(timeout);
    if (!doneReceived) throw new Error("Stream ended without done event");
  },

  submitAssessment: (answers: number[]): Promise<AssessmentResult> =>
    request<AssessmentResult>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ answers })
    }),

  analyzeState: (
    payload: {
      assessmentId?: string;
      text: string;
      sleepHours?: number;
      fatigueLevel?: number;
      socialWillingness?: number;
    }
  ): Promise<AnalysisResult> =>
    request<AnalysisResult>("/api/state/analyze", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getProfileSummary: (): Promise<ProfileSummary> => request<ProfileSummary>("/api/profile/summary"),

  getProfileTimeline: (): Promise<ProfileTimeline> => request<ProfileTimeline>("/api/profile/timeline")
};
