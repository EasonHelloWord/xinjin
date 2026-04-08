import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ChatMessage, ChatSession } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import { emitPulse } from "../lib/pulseBus";
import { voiceInput, VoiceStatus } from "../input/voiceInput";
import { ChatArea } from "./components/ChatArea";
import { EmotionPanel } from "./components/EmotionPanel";
import { Sidebar } from "./components/Sidebar";
import { AnalysisSummary, SessionItem } from "./components/types";

interface ChatDockProps {
  onLogout: () => void;
  chatEnabled: boolean;
  onRequestReassess: () => void;
  assessmentLabel: string;
  analysisSummary: AnalysisSummary;
  onAdviceRefresh?: (payload: { userText: string }) => void;
}

const makeId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toPreview = (messages: ChatMessage[]): string => {
  const last = messages[messages.length - 1];
  if (!last?.content) return "";
  return last.content.replace(/\s+/g, " ").trim().slice(0, 24);
};

const normalizeSessionItem = (session: ChatSession): SessionItem => ({
  ...session,
  title: session.title || "新对话",
  preview: ""
});

const dailyTaskCheckKey = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `xinjin.daily-microtasks.checked.${y}-${m}-${d}`;
};

const findRecoveredAssistant = (history: ChatMessage[], userText: string, startAt: number): ChatMessage | null => {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = history[j];
      if (prev.role !== "user") continue;
      if (prev.content === userText && prev.created_at >= startAt - 10_000) {
        return msg;
      }
      break;
    }
  }
  return null;
};

const recoverAssistantFromHistory = async (
  sessionId: string,
  userText: string,
  startAt: number,
  attempts = 8
): Promise<ChatMessage | null> => {
  for (let i = 0; i < attempts; i++) {
    const history = await api.getMessages(sessionId);
    const recovered = findRecoveredAssistant(history, userText, startAt);
    if (recovered) return recovered;
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }
  return null;
};

export function ChatDock({
  onLogout,
  chatEnabled,
  onRequestReassess,
  assessmentLabel,
  analysisSummary,
  onAdviceRefresh
}: ChatDockProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());

  const assistantTextRef = useRef("");
  const sendingRef = useRef(false);
  const recentSubmitRef = useRef<{ text: string; at: number } | null>(null);
  const loadSeqRef = useRef(0);
  const inputRef = useRef("");
  const voiceBaseInputRef = useRef<string | null>(null);

  const voiceInputActive = voiceStatus === "recording" || voiceStatus === "connecting";

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const stopSpeech = (): void => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const syncSessionList = async (): Promise<ChatSession[]> => {
    const raw = await api.listSessions();
    setSessions(raw.map(normalizeSessionItem));
    return raw;
  };

  const loadMessages = async (sessionId: string): Promise<void> => {
    const seq = ++loadSeqRef.current;
    const history = await api.getMessages(sessionId);
    if (seq !== loadSeqRef.current) return;
    setMessages(history);
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, preview: toPreview(history) } : s)));
  };

  const createSession = async (): Promise<string> => {
    setCreatingSession(true);
    try {
      const created = await api.createSession();
      const next: SessionItem = {
        ...created.session,
        preview: ""
      };
      setSessions((prev) => [next, ...prev.filter((item) => item.id !== next.id)]);
      setActiveSessionId(next.id);
      setMessages([]);
      void syncSessionList();
      return created.sessionId;
    } finally {
      setCreatingSession(false);
    }
  };

  const activateSession = async (sessionId: string): Promise<void> => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setError(null);
    await loadMessages(sessionId);
  };

  const resetToDraftSession = (): void => {
    stopSpeech();
    voiceInput.stop();
    setActiveSessionId("");
    setMessages([]);
    setInput("");
    setError(null);
  };

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        setError(null);
        const listed = await syncSessionList();
        const first = listed[0];
        if (first?.id) {
          await activateSession(first.id);
        }
      } catch (err) {
        setError((err as Error).message || "初始化会话失败");
      }
    };
    void init();
  }, []);

  useEffect(() => {
    const offVoiceStatus = voiceInput.onStatus(setVoiceStatus);
    const offTranscript = voiceInput.onTranscript((text) => {
      if (!chatEnabled) return;
      const normalized = text.trim().replace(/\s+/g, " ");
      if (!normalized) return;
      const base = voiceBaseInputRef.current ?? inputRef.current;
      voiceBaseInputRef.current = base;
      const prefix = base.trim();
      const next = prefix ? `${prefix} ${normalized}` : normalized;
      setInput(next);
    });

    return () => {
      offVoiceStatus();
      offTranscript();
      stopSpeech();
      voiceInput.stop();
    };
  }, [chatEnabled]);

  useEffect(() => {
    if (voiceInputActive) return;
    voiceBaseInputRef.current = null;
  }, [voiceInputActive]);

  useEffect(() => {
    const key = dailyTaskCheckKey();
    const raw = window.localStorage.getItem(key);
    const allowed = new Set(analysisSummary.microTasks);
    if (!raw) {
      setCheckedTaskIds(new Set());
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setCheckedTaskIds(new Set());
        return;
      }
      const valid = parsed.filter((item): item is string => typeof item === "string" && allowed.has(item));
      setCheckedTaskIds(new Set(valid));
    } catch {
      setCheckedTaskIds(new Set());
    }
  }, [analysisSummary.microTasks]);

  const persistCheckedTasks = (next: Set<string>): void => {
    window.localStorage.setItem(dailyTaskCheckKey(), JSON.stringify(Array.from(next)));
  };

  const updateSessionPreview = (sessionId: string, nextMessages: ChatMessage[]): void => {
    const preview = toPreview(nextMessages);
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, preview } : item)));
  };

  const speakWithPulse = (text: string): void => {
    if (!voiceEnabled) return;
    stopSpeech();
    if (!("speechSynthesis" in window)) {
      setError("当前浏览器不支持语音播报");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onboundary = () => emitPulse(0.25);
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (rawText: string): Promise<void> => {
    if (!chatEnabled || loading || sendingRef.current) return;
    const text = rawText.trim();
    if (!text) return;

    const last = recentSubmitRef.current;
    if (last && last.text === text && Date.now() - last.at < 1800) return;
    recentSubmitRef.current = { text, at: Date.now() };

    sendingRef.current = true;
    setError(null);

    try {
      const sid = activeSessionId || (await createSession());
      stopSpeech();

      const userMessage: ChatMessage = { id: makeId("u"), role: "user", content: text, created_at: Date.now() };
      const pendingAssistantId = makeId("a");
      const assistantPending: ChatMessage = { id: pendingAssistantId, role: "assistant", content: "", created_at: Date.now() };
      const optimisticMessages = [...messages, userMessage, assistantPending];

      setMessages(optimisticMessages);
      updateSessionPreview(sid, optimisticMessages);
      setInput("");
      setLoading(true);
      assistantTextRef.current = "";
      const requestStartedAt = Date.now();
      const clientMessageId = makeId("cmid");

      let doneMessageId = "";

      try {
        await api.streamMessage(sid, text, { voice: voiceEnabled, clientMessageId }, {
          onToken: (tokenText) => {
            assistantTextRef.current += tokenText;
            emitPulse(0.16 + Math.random() * 0.12);
            flushSync(() => {
              setMessages((prev) =>
                prev.map((msg) => (msg.id === pendingAssistantId ? { ...msg, content: assistantTextRef.current } : msg))
              );
            });
          },
          onPulse: (v) => emitPulse(v),
          onDone: (messageId) => {
            doneMessageId = messageId;
          }
        });
      } catch (streamErr) {
        const recovered = await recoverAssistantFromHistory(sid, text, requestStartedAt);
        if (recovered) {
          assistantTextRef.current = recovered.content;
          doneMessageId = recovered.id;
        } else {
          throw streamErr;
        }
      }

      if (doneMessageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === pendingAssistantId ? { ...msg, id: doneMessageId, content: assistantTextRef.current } : msg
          )
        );
      }

      if (assistantTextRef.current && voiceEnabled) {
        speakWithPulse(assistantTextRef.current);
      }

      const latest = await api.getMessages(sid);
      setMessages(latest);
      updateSessionPreview(sid, latest);
      if (assistantTextRef.current) {
        onAdviceRefresh?.({ userText: text });
      }
    } catch (err) {
      setError((err as Error).message || "发送失败");
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  };

  const onSelectSession = async (sessionId: string): Promise<void> => {
    if (sessionId === activeSessionId) return;
    try {
      await activateSession(sessionId);
    } catch (err) {
      setError((err as Error).message || "读取历史消息失败");
    }
  };

  const onDeleteSession = async (sessionId: string): Promise<void> => {
    if (loading || creatingSession || deletingSessionId) return;
    const target = sessions.find((item) => item.id === sessionId);
    const title = target?.title || "未命名会话";
    if (!window.confirm(`删除会话“${title}”？该会话中的消息会一并删除。`)) return;

    const remainingSessions = sortedSessions.filter((item) => item.id !== sessionId);
    const deletingActive = sessionId === activeSessionId;

    setDeletingSessionId(sessionId);
    setError(null);

    try {
      if (deletingActive) {
        stopSpeech();
        voiceInput.stop();
      }

      await api.deleteSession(sessionId);
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));

      if (!deletingActive) {
        return;
      }

      if (remainingSessions[0]?.id) {
        await activateSession(remainingSessions[0].id);
        return;
      }

      resetToDraftSession();
    } catch (err) {
      setError((err as Error).message || "删除会话失败");
    } finally {
      setDeletingSessionId("");
    }
  };

  const onToggleVoiceInput = (): void => {
    if (voiceInputActive) {
      voiceInput.stop();
      return;
    }
    voiceBaseInputRef.current = inputRef.current;
    void voiceInput.start();
  };

  const onToggleVoiceOutput = (enabled: boolean): void => {
    setVoiceEnabled(enabled);
    if (!enabled) {
      stopSpeech();
      return;
    }
    if (!("speechSynthesis" in window)) {
      setVoiceEnabled(false);
      setError("当前浏览器不支持语音播报");
    }
  };

  const onToggleTask = (task: string): void => {
    setCheckedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      persistCheckedTasks(next);
      return next;
    });
  };

  const onSubmit = (): void => {
    void sendMessage(input);
  };

  const onCreateSession = (): void => {
    if (loading || creatingSession || deletingSessionId) return;
    resetToDraftSession();
  };

  const onReassess = (): void => {
    stopSpeech();
    voiceInput.stop();
    onRequestReassess();
  };

  const onLogoutClick = (): void => {
    stopSpeech();
    voiceInput.stop();
    clearAuthToken();
    onLogout();
  };

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.created_at - a.created_at),
    [sessions]
  );

  const disabled = loading || !chatEnabled;

  return (
    <div className="mira-workbench">
      <Sidebar
        search={search}
        onSearch={setSearch}
        sessions={sortedSessions}
        activeSessionId={activeSessionId}
        onSelectSession={(sid) => void onSelectSession(sid)}
        onDeleteSession={(sid) => void onDeleteSession(sid)}
        onCreateSession={onCreateSession}
        onRequestReassess={onReassess}
        onLogout={onLogoutClick}
        creating={creatingSession}
        deletingSessionId={deletingSessionId}
      />

      <ChatArea
        messages={messages}
        analysisSummary={analysisSummary}
        assessmentLabel={assessmentLabel}
        inputValue={input}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onToggleVoiceInput={onToggleVoiceInput}
        onToggleVoiceOutput={onToggleVoiceOutput}
        voiceOutputEnabled={voiceEnabled}
        voiceInputActive={voiceInputActive}
        disabled={disabled}
        loading={loading}
      />

      <EmotionPanel
        sixDimAdvice={analysisSummary.sixDimAdvice}
        microTasks={analysisSummary.microTasks}
        checkedTaskIds={checkedTaskIds}
        onToggleTask={onToggleTask}
      />

      {error && <div className="mira-error-toast">{error}</div>}
    </div>
  );
}
