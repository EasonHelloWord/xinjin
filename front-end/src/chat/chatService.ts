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

const toPreset = (value?: string): PresetName | undefined => {
  if (!value) return undefined;
  const set = new Set(["neutral", "happy", "sad", "angry", "anxious", "overloaded", "tired", "calm"]);
  return set.has(value) ? (value as PresetName) : undefined;
};

export class ChatService {
  private listeners = new Set<MessageHandler>();

  constructor() {
    inputBus.on("system_response", (payload) => {
      this.emitMessage({
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "system",
        text: payload.text,
        ts: Date.now()
      });
    });
  }

  onMessage(cb: MessageHandler): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sendText(text: string): void {
    this.emitMessage({
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      text,
      ts: Date.now()
    });

    textInputChannel.send(text);
  }

  private emitMessage(message: ChatMessage): void {
    this.listeners.forEach((cb) => cb(message));
  }

  normalizeSuggestedPreset(raw?: string): PresetName | undefined {
    return toPreset(raw);
  }
}

export const chatService = new ChatService();
