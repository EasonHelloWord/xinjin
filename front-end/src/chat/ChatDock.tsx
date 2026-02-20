import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ChatMessage } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import { emitPulse } from "../lib/pulseBus";
import { voiceInput, VoiceStatus } from "../input/voiceInput";

type ChatMode = "text" | "voice";

interface ChatDockProps {
  onCollapsedChange?: (collapsed: boolean) => void;
  onLogout: () => void;
}

const makeId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function ChatDock({ onCollapsedChange, onLogout }: ChatDockProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ChatMode>("text");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const binsRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(64) as Uint8Array<ArrayBuffer>);
  const levelRef = useRef(0);
  const vizRafRef = useRef<number | null>(null);
  const currentSpeechTimerRef = useRef<number | null>(null);
  const assistantTextRef = useRef("");

  const voiceOutputLabel = useMemo(
    () => (voiceEnabled ? "\u8bed\u97f3\u64ad\u62a5\uff1a\u5f00\u542f" : "\u8bed\u97f3\u64ad\u62a5\uff1a\u5173\u95ed"),
    [voiceEnabled]
  );

  const voiceInputLabel = useMemo(() => {
    if (voiceStatus === "connecting") return "\u8bed\u97f3\u8f93\u5165\u8fde\u63a5\u4e2d...";
    if (voiceStatus === "recording") {
      return "\u8bed\u97f3\u8f93\u5165\u8fdb\u884c\u4e2d\uff08\u5df2\u4e0a\u4f20\u5230\u540e\u7aef\uff09";
    }
    if (voiceStatus === "disabled") return "\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u8bed\u97f3\u8f93\u5165";
    return "\u8bed\u97f3\u8f93\u5165\u672a\u5f00\u542f";
  }, [voiceStatus]);

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const created = await api.createSession();
    setSessionId(created.sessionId);
    return created.sessionId;
  };

  const reloadMessages = async (sid: string): Promise<void> => {
    const history = await api.getMessages(sid);
    setMessages(history);
  };

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        setError(null);
        const created = await api.createSession();
        setSessionId(created.sessionId);
        await reloadMessages(created.sessionId);
      } catch (err) {
        setError((err as Error).message);
      }
    };

    void init();
  }, []);

  useEffect(() => {
    const offVoiceStatus = voiceInput.onStatus(setVoiceStatus);
    const offMeter = voiceInput.onMeter((meter) => {
      binsRef.current = meter.bins;
      levelRef.current = meter.level;
    });
    const offTranscript = voiceInput.onTranscript((text) => {
      void sendMessage(text);
    });

    return () => {
      offVoiceStatus();
      offMeter();
      offTranscript();
      stopSpeech();
      voiceInput.stop();
    };
  }, []);

  useEffect(() => {
    if (mode !== "voice") {
      if (vizRafRef.current !== null) {
        cancelAnimationFrame(vizRafRef.current);
        vizRafRef.current = null;
      }
      return;
    }

    const canvas = vizCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
      ctx.fillRect(0, 0, w, h);

      const bins = binsRef.current;
      const count = Math.max(1, bins.length);
      const gap = 2;
      const barW = Math.max(2, (w - gap * (count - 1)) / count);
      const levelBoost = 0.35 + levelRef.current * 0.95;

      for (let i = 0; i < count; i++) {
        const v = bins[i] / 255;
        const barH = Math.max(2, h * v * levelBoost);
        const x = i * (barW + gap);
        const y = h - barH;
        const alpha = 0.2 + v * 0.7;
        ctx.fillStyle = `rgba(115, 224, 173, ${alpha})`;
        ctx.fillRect(x, y, barW, barH);
      }

      vizRafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (vizRafRef.current !== null) {
        cancelAnimationFrame(vizRafRef.current);
        vizRafRef.current = null;
      }
    };
  }, [mode]);

  const stopSpeech = (): void => {
    if (currentSpeechTimerRef.current !== null) {
      window.clearInterval(currentSpeechTimerRef.current);
      currentSpeechTimerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakWithPulse = (text: string): void => {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    stopSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      emitPulse(0.4);
      currentSpeechTimerRef.current = window.setInterval(() => {
        emitPulse(0.15 + Math.random() * 0.2);
      }, 80);
    };

    utterance.onboundary = () => {
      emitPulse(0.25);
    };

    const finish = (): void => {
      if (currentSpeechTimerRef.current !== null) {
        window.clearInterval(currentSpeechTimerRef.current);
        currentSpeechTimerRef.current = null;
      }
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (rawText: string): Promise<void> => {
    if (loading) return;

    const text = rawText.trim();
    if (!text) return;

    setError(null);

    try {
      const sid = await ensureSession();
      stopSpeech();

      const userMessage: ChatMessage = {
        id: makeId("u"),
        role: "user",
        content: text,
        created_at: Date.now()
      };

      const pendingAssistantId = makeId("a");
      const assistantPending: ChatMessage = {
        id: pendingAssistantId,
        role: "assistant",
        content: "",
        created_at: Date.now()
      };

      setMessages((prev) => [...prev, userMessage, assistantPending]);
      setInput("");
      setLoading(true);
      assistantTextRef.current = "";

      let doneMessageId = "";
      await api.streamMessage(sid, text, { voice: voiceEnabled }, {
        onToken: (tokenText) => {
          assistantTextRef.current += tokenText;
          emitPulse(0.16 + Math.random() * 0.12);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === pendingAssistantId
                ? {
                    ...msg,
                    content: assistantTextRef.current
                  }
                : msg
            )
          );
        },
        onPulse: (v) => {
          emitPulse(v);
        },
        onDone: (messageId) => {
          doneMessageId = messageId;
        }
      });

      if (doneMessageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === pendingAssistantId
              ? {
                  ...msg,
                  id: doneMessageId
                }
              : msg
          )
        );
      }

      if (assistantTextRef.current && voiceEnabled) {
        speakWithPulse(assistantTextRef.current);
      }

      await reloadMessages(sid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async (): Promise<void> => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const sid = await ensureSession();
      await api.clearMessages(sid);
      setMessages([]);
      stopSpeech();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    await sendMessage(input);
  };

  const toggleVoiceInput = (): void => {
    if (voiceStatus === "recording" || voiceStatus === "connecting") {
      voiceInput.stop();
      return;
    }
    void voiceInput.start();
  };

  const switchToTextMode = (): void => {
    if (voiceStatus === "recording" || voiceStatus === "connecting") {
      voiceInput.stop();
    }
    setMode("text");
  };

  const logout = (): void => {
    stopSpeech();
    voiceInput.stop();
    clearAuthToken();
    onLogout();
  };

  return (
    <div className={`chat-dock ${collapsed ? "collapsed" : ""}`}>
      <div className="chat-header">
        <span>{"\u804a\u5929"}</span>
        <div className="chat-actions">
          <button type="button" onClick={clearHistory} disabled={loading || !sessionId}>
            {"\u6e05\u7a7a\u5386\u53f2"}
          </button>
          <button type="button" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? "\u5c55\u5f00" : "\u6536\u8d77"}
          </button>
          <button type="button" onClick={logout}>{"\u9000\u51fa\u767b\u5f55"}</button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="session-row">
            <span className="session-single">{"\u5f53\u524d\u4ec5\u4f7f\u7528\u4e00\u4e2a\u4f1a\u8bdd"}</span>
            <label className="voice-toggle">
              <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} />
              {voiceOutputLabel}
            </label>
          </div>

          <div className="chat-messages" ref={messagesRef}>
            {messages.length === 0 && <div className="chat-empty">{"\u53d1\u9001\u7b2c\u4e00\u6761\u6d88\u606f\u5f00\u59cb\u5bf9\u8bdd"}</div>}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble ${msg.role === "user" ? "user" : "system"}`}>
                {msg.content}
              </div>
            ))}
          </div>

          {error && <div className="message-box">{error}</div>}

          {mode === "text" ? (
            <form onSubmit={onSubmit} className="chat-form">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={"\u8f93\u5165\u4f60\u60f3\u8bf4\u7684\u8bdd..."}
                disabled={loading || !sessionId}
              />
              <button type="submit" disabled={loading || !sessionId}>
                {loading ? "\u751f\u6210\u4e2d..." : "\u53d1\u9001"}
              </button>
              <button type="button" onClick={() => setMode("voice")}>{"\u8bed\u97f3\u8f93\u5165"}</button>
            </form>
          ) : (
            <div className="voice-panel">
              <canvas className="voice-visualizer" ref={vizCanvasRef} />
              <div className="voice-row">
                <button type="button" onClick={toggleVoiceInput} disabled={voiceStatus === "disabled" || loading}>
                  {voiceStatus === "recording" || voiceStatus === "connecting"
                    ? "\u7ed3\u675f\u8bed\u97f3\u8f93\u5165"
                    : "\u5f00\u59cb\u8bed\u97f3\u8f93\u5165"}
                </button>
                <button type="button" onClick={switchToTextMode}>{"\u8fd4\u56de\u6587\u5b57\u8f93\u5165"}</button>
                <span>{voiceInputLabel}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}