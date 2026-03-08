import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisResult, api, StateType, UserLevel } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import { emitPulse } from "../lib/pulseBus";
import { voiceInput, VoiceStatus } from "../input/voiceInput";

type ChatMode = "text" | "voice";

interface ChatDockProps {
  onLogout: () => void;
  chatEnabled: boolean;
  analysisResult: AnalysisResult | null;
  onRequestReassess: () => void;
  levelLabel: (level: UserLevel) => string;
  stateTypeLabel: (stateType: StateType) => string;
}

export function ChatDock({
  onLogout,
  chatEnabled,
  analysisResult,
  onRequestReassess,
  levelLabel,
  stateTypeLabel
}: ChatDockProps): JSX.Element {
  const [mode, setMode] = useState<ChatMode>("text");
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [streamingReply, setStreamingReply] = useState("");
  const [assistantReplies, setAssistantReplies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    if (voiceStatus === "recording") return "\u8bed\u97f3\u8f93\u5165\u8fdb\u884c\u4e2d\uff08\u5df2\u4e0a\u4f20\u5230\u540e\u7aef\uff09";
    if (voiceStatus === "disabled") return "\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u8bed\u97f3\u8f93\u5165";
    return "\u8bed\u97f3\u8f93\u5165\u672a\u5f00\u542f";
  }, [voiceStatus]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const created = await api.createSession();
    setSessionId(created.sessionId);
    return created.sessionId;
  };

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        setError(null);
        const created = await api.createSession();
        setSessionId(created.sessionId);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    void init();
  }, []);

  const stopSpeech = (): void => {
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

  const speakWithPulse = (text: string): void => {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      emitPulse(0.4);
      currentSpeechTimerRef.current = window.setInterval(() => emitPulse(0.15 + Math.random() * 0.2), 80);
    };
    utterance.onboundary = () => emitPulse(0.25);

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
    if (!chatEnabled || loading) return;
    const text = rawText.trim();
    if (!text) return;

    setError(null);
    setInput("");
    setLoading(true);
    setStreamingReply("");
    assistantTextRef.current = "";

    try {
      const sid = await ensureSession();
      stopSpeech();
      let doneReceived = false;

      await api.streamMessage(sid, text, { voice: voiceEnabled }, {
        onToken: (tokenText) => {
          assistantTextRef.current += tokenText;
          setStreamingReply(assistantTextRef.current);
          emitPulse(0.16 + Math.random() * 0.12);
        },
        onPulse: (v) => emitPulse(v),
        onDone: () => {
          doneReceived = true;
        }
      });

      if (doneReceived && assistantTextRef.current.trim()) {
        const reply = assistantTextRef.current;
        setAssistantReplies((prev) => [reply, ...prev].slice(0, 3));
        setStreamingReply("");
        if (voiceEnabled) {
          speakWithPulse(reply);
        }
      }
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

  const onReassess = (): void => {
    setAssistantReplies([]);
    setStreamingReply("");
    onRequestReassess();
  };

  const chatInputDisabled = loading || !sessionId || !chatEnabled;

  return (
    <div className="chat-dock">
      <div className="chat-header">
        <span>{"\u804a\u5929"}</span>
        <div className="chat-actions">
          <button type="button" onClick={onReassess} disabled={loading || !sessionId}>
            {"\u91cd\u65b0\u8bc4\u4f30"}
          </button>
          <button type="button" onClick={logout}>{"\u9000\u51fa\u767b\u5f55"}</button>
        </div>
      </div>

      <div className="session-row">
        <span className="session-single">
          {chatEnabled
            ? "\u7ed3\u679c\u5df2\u540c\u6b65\u5230\u4e0a\u65b9\u4e3b\u821e\u53f0\uff0c\u8bf7\u5728\u4e0b\u65b9\u8865\u5145\u60c5\u51b5\u3002"
            : "\u8bf7\u5148\u5728\u4e3b\u821e\u53f0\u5b8c\u6210\u8bc4\u4f30\u4e0e\u5206\u6790\u3002"}
        </span>
        <label className="voice-toggle">
          <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} />
          {voiceOutputLabel}
        </label>
      </div>

      {analysisResult && (
        <div className="chat-guidance">
          <div className="chat-guidance-title">
            {`状态提示：${stateTypeLabel(analysisResult.stateType)} | ${levelLabel(analysisResult.level)}`}
          </div>
          <div className="chat-guidance-summary">{analysisResult.summary}</div>
          <div className="task-list">
            {analysisResult.microTasks.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          {streamingReply && <div className="chat-guidance-ai">{`AI 回复中：${streamingReply}`}</div>}
          {assistantReplies.map((reply, idx) => (
            <div key={`${idx}-${reply.slice(0, 12)}`} className="chat-guidance-ai">
              {`AI 补充：${reply}`}
            </div>
          ))}
          {analysisResult.riskNotice && <div className="risk-notice">{analysisResult.riskNotice}</div>}
        </div>
      )}

      {error && <div className="message-box">{error}</div>}

      {mode === "text" ? (
        <form onSubmit={onSubmit} className="chat-form">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={chatEnabled ? "\u8f93\u5165\u4f60\u73b0\u5728\u7684\u8865\u5145\u4fe1\u606f..." : "\u8bf7\u5148\u5b8c\u6210\u4e0a\u65b9\u5206\u6790"}
            disabled={chatInputDisabled}
          />
          <button type="submit" disabled={chatInputDisabled}>
            {loading ? "\u751f\u6210\u4e2d..." : "\u53d1\u9001"}
          </button>
          <button type="button" onClick={() => setMode("voice")} disabled={!chatEnabled}>
            {"\u8bed\u97f3\u8f93\u5165"}
          </button>
        </form>
      ) : (
        <div className="voice-panel">
          <canvas className="voice-visualizer" ref={vizCanvasRef} />
          <div className="voice-row">
            <button type="button" onClick={toggleVoiceInput} disabled={voiceStatus === "disabled" || loading || !chatEnabled}>
              {voiceStatus === "recording" || voiceStatus === "connecting"
                ? "\u7ed3\u675f\u8bed\u97f3\u8f93\u5165"
                : "\u5f00\u59cb\u8bed\u97f3\u8f93\u5165"}
            </button>
            <button type="button" onClick={switchToTextMode}>{"\u8fd4\u56de\u6587\u5b57\u8f93\u5165"}</button>
            <span>{voiceInputLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
