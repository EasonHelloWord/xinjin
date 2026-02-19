// 聊天浮层：支持文本输入、语音占位输入，并展示消息列表。
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChatMessage, chatService } from "./chatService";
import { voiceInput, VoiceStatus } from "../input/voiceInput";
import { inputBus } from "../events/inputBus";

interface ChatDockProps {
  // 打开视频输入面板（父组件控制）
  onOpenVideoPanel: () => void;
}

export function ChatDock({ onOpenVideoPanel }: ChatDockProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  // 根据录音状态显示不同文案。
  const voiceLabel = useMemo(() => {
    if (voiceStatus === "recording") return "录音中...";
    if (voiceStatus === "disabled") return "语音不可用";
    return "语音输入（未启用）";
  }, [voiceStatus]);

  useEffect(() => {
    // 订阅聊天消息和语音状态，组件卸载时自动取消。
    const offMessage = chatService.onMessage((msg) => {
      // 只保留最近 20 条，避免无限增长。
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
    // 记录用户行为事件，方便后续埋点或日志分析。
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
