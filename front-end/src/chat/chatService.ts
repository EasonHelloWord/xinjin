import { PresetName } from "../state/types";
import { textInputChannel } from "../input/textInput";
import { inputBus } from "../events/inputBus";

export interface ChatMessage {
  id: string;
  role: "user" | "system";
  text: string;
  ts: number;
}

type MessageHandler = (message: ChatMessage) => void;

const choosePreset = (text: string): PresetName | undefined => {
  const t = text.toLowerCase();
  if (t.includes("焦虑") || t.includes("anxious") || t.includes("紧张")) return "anxious";
  if (t.includes("开心") || t.includes("happy") || t.includes("高兴")) return "happy";
  if (t.includes("生气") || t.includes("angry")) return "angry";
  if (t.includes("难过") || t.includes("sad")) return "sad";
  if (t.includes("过载") || t.includes("累") || t.includes("overload")) return "overloaded";
  return "neutral";
};

export class ChatService {
  private listeners = new Set<MessageHandler>();

  onMessage(cb: MessageHandler): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sendText(text: string): void {
    const msg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      ts: Date.now()
    };
    this.emitMessage(msg);
    textInputChannel.send(text);

    window.setTimeout(() => {
      const suggestedPreset = choosePreset(text);
      const replyText = `系统占位回复：已收到“${text.slice(0, 28)}”，建议状态：${suggestedPreset ?? "neutral"}`;
      const reply: ChatMessage = {
        id: `s-${Date.now()}`,
        role: "system",
        text: replyText,
        ts: Date.now()
      };
      this.emitMessage(reply);
      inputBus.emit("system_response", { text: replyText, suggestedPreset });
    }, 300);
  }

  private emitMessage(message: ChatMessage): void {
    this.listeners.forEach((cb) => cb(message));
  }
}

export const chatService = new ChatService();
