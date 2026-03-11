import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ChatMessage } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import { emitPulse } from "../lib/pulseBus";
import { voiceInput, VoiceStatus } from "../input/voiceInput";
import { voiceTts } from "../input/voiceTts";

type ChatMode = "text" | "voice";

interface ChatDockProps {
  onLogout: () => void;
  chatEnabled: boolean;
  onRequestReassess: () => void;
  assessmentLabel: string;
  onAdviceRefresh?: (payload: { userText: string }) => void;
}

const makeId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ENABLE_BROWSER_TTS_FALLBACK = String(import.meta.env.VITE_ENABLE_BROWSER_TTS_FALLBACK || "").toLowerCase() === "true";

const findRecoveredAssistant = (
  history: ChatMessage[],
  userText: string,
  startAt: number
): ChatMessage | null => {
  // Prefer the assistant message that follows a just-sent matching user message.
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

export function ChatDock({ onLogout, chatEnabled, onRequestReassess, assessmentLabel, onAdviceRefresh }: ChatDockProps): JSX.Element {
  const [mode, setMode] = useState<ChatMode>("text");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceDebug, setVoiceDebug] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const binsRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(64) as Uint8Array<ArrayBuffer>);
  const levelRef = useRef(0);
  const vizRafRef = useRef<number | null>(null);
  const currentSpeechTimerRef = useRef<number | null>(null);
  const assistantTextRef = useRef("");
  const sendingRef = useRef(false);
  const recentSubmitRef = useRef<{ text: string; at: number } | null>(null);

  const voiceOutputLabel = useMemo(
    () => (voiceEnabled ? "\u8bed\u97f3\u64ad\u62a5\uff1a\u5f00\u542f" : "\u8bed\u97f3\u64ad\u62a5\uff1a\u5173\u95ed"),
    [voiceEnabled]
  );

  const voiceInputLabel = useMemo(() => {
    if (voiceStatus === "connecting") return "\u8bed\u97f3\u8f93\u5165\u8fde\u63a5\u4e2d...";
    if (voiceStatus === "recording") return "\u8bed\u97f3\u8f93\u5165\u8fdb\u884c\u4e2d\uff08\u5df2\u4e0a\u4f20\u5230\u540e\u7aef\uff09";
    if (voiceStatus === "disabled") return "\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u8bed\u97f3\u8f93\u5165";
    return "\u8bed\u97f3\u8f93\u5165\u672a\u5f00\u542f";
  }, [voiceStatus]);

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

  const stopSpeech = (): void => {
    voiceTts.stop();
    if (currentSpeechTimerRef.current !== null) {
      window.clearInterval(currentSpeechTimerRef.current);
      currentSpeechTimerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  useEffect(() => {
    const offVoiceStatus = voiceInput.onStatus(setVoiceStatus);
    const offVoiceDebug = voiceTts.onDebug((line) => {
      setVoiceDebug((prev) => {
        const next = [...prev, `${new Date().toLocaleTimeString()} ${line}`];
        return next.slice(-6);
      });
    });
    const offMeter = voiceInput.onMeter((meter) => {
      binsRef.current = meter.bins;
      levelRef.current = meter.level;
    });
    const offTranscript = voiceInput.onTranscript((text) => {
      if (!chatEnabled) return;
      void sendMessage(text);
    });
    return () => {
      offVoiceStatus();
      offVoiceDebug();
      offMeter();
      offTranscript();
      stopSpeech();
      voiceInput.stop();
    };
  }, [chatEnabled]);

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
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
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
        ctx.fillStyle = `rgba(49, 93, 138, ${alpha})`;
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

  const speakWithPulse = (text: string): void => {
    if (!voiceEnabled) return;
    stopSpeech();
    emitPulse(0.4);
    currentSpeechTimerRef.current = window.setInterval(() => emitPulse(0.15 + Math.random() * 0.2), 80);
    void voiceTts
      .speak(text)
      .catch((err) => {
        if (ENABLE_BROWSER_TTS_FALLBACK && "speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = 1;
          utterance.onboundary = () => emitPulse(0.25);
          window.speechSynthesis.speak(utterance);
          return;
        }
        setError((err as Error).message || "云端语音播报失败（未启用浏览器回退）");
      })
      .finally(() => {
        if (currentSpeechTimerRef.current !== null) {
          window.clearInterval(currentSpeechTimerRef.current);
          currentSpeechTimerRef.current = null;
        }
      });
  };

  const sendMessage = async (rawText: string): Promise<void> => {
    if (!chatEnabled || loading || sendingRef.current) return;
    const text = rawText.trim();
    if (!text) return;

    const last = recentSubmitRef.current;
    if (last && last.text === text && Date.now() - last.at < 1800) {
      return;
    }
    recentSubmitRef.current = { text, at: Date.now() };

    sendingRef.current = true;
    setError(null);

    try {
      const sid = await ensureSession();
      stopSpeech();

      const userMessage: ChatMessage = { id: makeId("u"), role: "user", content: text, created_at: Date.now() };
      const pendingAssistantId = makeId("a");
      const assistantPending: ChatMessage = { id: pendingAssistantId, role: "assistant", content: "", created_at: Date.now() };

      setMessages((prev) => [...prev, userMessage, assistantPending]);
      setInput("");
      setLoading(true);
      assistantTextRef.current = "";
      const requestStartedAt = Date.now();
      const clientMessageId = makeId("cmid");

      let doneMessageId = "";
      let tokenReceived = false;
      try {
        await api.streamMessage(sid, text, { voice: voiceEnabled, clientMessageId }, {
          onToken: (tokenText) => {
            tokenReceived = true;
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
        // Fallback only when stream fails before any token arrives.
        // First try to recover the just-written server reply to avoid duplicate send.
        if (!tokenReceived) {
          const history = await api.getMessages(sid);
          const recovered = findRecoveredAssistant(history, text, requestStartedAt);
          if (recovered) {
            assistantTextRef.current = recovered.content;
            doneMessageId = recovered.id;
          } else {
            const fallback = await api.sendMessageOnce(sid, text, { voice: voiceEnabled, clientMessageId });
            assistantTextRef.current = fallback.assistantMessage.content;
            doneMessageId = fallback.assistantMessage.id;
          }
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
      await reloadMessages(sid);
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

  const clearHistory = async (): Promise<void> => {
    if (!sessionId) return;
    await api.clearMessages(sessionId);
    setMessages([]);
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

  const chatInputDisabled = loading || !sessionId || !chatEnabled;
  const onReassess = async (): Promise<void> => {
    if (loading || !sessionId) return;
    setError(null);
    setLoading(true);
    try {
      stopSpeech();
      voiceInput.stop();
      await clearHistory();
      onRequestReassess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onToggleVoiceOutput = (enabled: boolean): void => {
    setVoiceEnabled(enabled);
    if (!enabled) {
      stopSpeech();
      return;
    }
    void voiceTts.unlock().catch((err) => {
      setVoiceEnabled(false);
      setError((err as Error).message || "浏览器阻止了语音播放，请点击页面后重试");
    });
  };

  return (
    <div className="chat-dock">
      <div className="chat-header">
        <span>{"聊天"}</span>
        <div className="chat-actions">
          <button type="button" onClick={() => void onReassess()} disabled={loading || !sessionId}>
            {"重新评估"}
          </button>
          <button type="button" onClick={logout}>{"退出登录"}</button>
        </div>
      </div>

      <div className="session-row">
        <span className="session-single">
          {assessmentLabel ? `评估结果：${assessmentLabel}` : "评估已完成，你可以继续补充情况。"}
        </span>
        <label className="voice-toggle">
          <input type="checkbox" checked={voiceEnabled} onChange={(e) => onToggleVoiceOutput(e.target.checked)} />
          {voiceOutputLabel}
        </label>
      </div>

      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            {"发送一条补充信息，我会结合当前状态继续陪你梳理。"}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role === "user" ? "user" : "system"}`}>
            {msg.content}
          </div>
        ))}
      </div>

      {error && <div className="message-box">{error}</div>}
      <div className="voice-debug-box">
        {voiceDebug.length > 0 ? (
          voiceDebug.map((line, idx) => (
            <div key={`${idx}-${line}`} className="voice-debug-line">
              {line}
            </div>
          ))
        ) : (
          <div className="voice-debug-line">语音调试：等待事件...</div>
        )}
      </div>

      {mode === "text" ? (
        <form onSubmit={onSubmit} className="chat-form">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={"输入你现在的补充信息..."} disabled={chatInputDisabled} />
          <button type="submit" disabled={chatInputDisabled}>
            {loading ? "生成中..." : "发送"}
          </button>
          <button type="button" onClick={() => setMode("voice")} disabled={!chatEnabled}>
            {"语音输入"}
          </button>
        </form>
      ) : (
        <div className="voice-panel">
          <canvas className="voice-visualizer" ref={vizCanvasRef} />
          <div className="voice-row">
            <button type="button" onClick={toggleVoiceInput} disabled={voiceStatus === "disabled" || loading || !chatEnabled}>
              {voiceStatus === "recording" || voiceStatus === "connecting" ? "结束语音输入" : "开始语音输入"}
            </button>
            <button type="button" onClick={switchToTextMode}>{"返回文字输入"}</button>
            <span>{voiceInputLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
