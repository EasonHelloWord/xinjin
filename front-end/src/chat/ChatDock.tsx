import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage, chatService } from "./chatService";
import { voiceInput, VoiceStatus } from "../input/voiceInput";
import { inputBus } from "../events/inputBus";

type ChatMode = "text" | "voice";

interface ChatDockProps {
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function ChatDock({ onCollapsedChange }: ChatDockProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ChatMode>("text");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const binsRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(64) as Uint8Array<ArrayBuffer>);
  const levelRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const voiceLabel = useMemo(() => {
    if (voiceStatus === "connecting") return "语音通道连接中...";
    if (voiceStatus === "recording") return "正在语音聊天（流式上传中）";
    if (voiceStatus === "disabled") return "当前环境不支持语音";
    return "点击开始语音聊天";
  }, [voiceStatus]);

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    const offMessage = chatService.onMessage((msg) => {
      setMessages((prev) => [...prev.slice(-80), msg]);
    });
    const offVoice = voiceInput.onStatus(setVoiceStatus);
    const offMeter = voiceInput.onMeter((meter) => {
      binsRef.current = meter.bins;
      levelRef.current = meter.level;
    });
    return () => {
      offMessage();
      offVoice();
      offMeter();
    };
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (mode !== "voice") {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
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

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [mode]);

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    chatService.sendText(text);
    inputBus.emit("user_action", { type: "chat_send" });
    setInput("");
  };

  const toggleVoiceChat = (): void => {
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

  return (
    <div className={`chat-dock ${collapsed ? "collapsed" : ""}`}>
      <div className="chat-header">
        <span>聊天</span>
        <div className="chat-actions">
          <button onClick={() => setCollapsed((v) => !v)}>{collapsed ? "展开" : "收起"}</button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="chat-messages" ref={messagesRef}>
            {messages.length === 0 && <div className="chat-empty">发送文本或开启语音聊天。</div>}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                {msg.text}
              </div>
            ))}
          </div>

          {mode === "text" ? (
            <form onSubmit={onSubmit} className="chat-form">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入文本..." />
              <button type="submit">发送</button>
              <button type="button" onClick={() => setMode("voice")}>语音模式</button>
            </form>
          ) : (
            <div className="voice-panel">
              <canvas className="voice-visualizer" ref={vizCanvasRef} />
              <div className="voice-row">
                <button onClick={toggleVoiceChat} disabled={voiceStatus === "disabled"}>
                  {voiceStatus === "recording" || voiceStatus === "connecting" ? "结束语音" : "语音聊天"}
                </button>
                <button onClick={switchToTextMode}>切回文本模式</button>
                <span>{voiceLabel}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
