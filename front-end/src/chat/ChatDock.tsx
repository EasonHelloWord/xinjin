import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChatMessage, chatService } from "./chatService";
import { voiceInput, VoiceStatus } from "../input/voiceInput";
import { inputBus } from "../events/inputBus";

interface ChatDockProps {
  onOpenVideoPanel: () => void;
}

export function ChatDock({ onOpenVideoPanel }: ChatDockProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const voiceLabel = useMemo(() => {
    if (voiceStatus === "recording") return "录音中...";
    if (voiceStatus === "disabled") return "语音不可用";
    return "语音输入（未启用）";
  }, [voiceStatus]);

  useEffect(() => {
    const offMessage = chatService.onMessage((msg) => {
      setMessages((prev) => [...prev.slice(-20), msg]);
    });
    const offVoice = voiceInput.onStatus(setVoiceStatus);
    return () => {
      offMessage();
      offVoice();
    };
  }, []);

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    chatService.sendText(text);
    inputBus.emit("user_action", { type: "chat_send" });
    setInput("");
  };

  const toggleVoice = (): void => {
    if (voiceStatus === "recording") {
      voiceInput.stop();
      return;
    }
    voiceInput.start();
  };

  return (
    <div className={`chat-dock ${collapsed ? "collapsed" : ""}`}>
      <div className="chat-header">
        <span>ChatDock</span>
        <div className="chat-actions">
          <button onClick={onOpenVideoPanel}>视频输入</button>
          <button onClick={() => setCollapsed((v) => !v)}>{collapsed ? "展开" : "收起"}</button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="chat-messages">
            {messages.length === 0 && <div className="chat-empty">发送消息以触发 mock 系统响应。</div>}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="voice-row">
            <button onClick={toggleVoice} disabled={voiceStatus === "disabled"}>
              {voiceStatus === "recording" ? "停止" : "麦克风"}
            </button>
            <span>{voiceLabel}</span>
          </div>
          <form onSubmit={onSubmit} className="chat-form">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入文本..." />
            <button type="submit">发送</button>
          </form>
        </>
      )}
    </div>
  );
}
