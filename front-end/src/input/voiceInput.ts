import { inputBus } from "../events/inputBus";
import { chatService } from "../chat/chatService";

export type VoiceStatus = "idle" | "recording" | "disabled";

export class VoiceInput {
  private status: VoiceStatus = "idle";
  private timer: number | null = null;
  private listeners = new Set<(status: VoiceStatus) => void>();

  isSupported(): boolean {
    return typeof window !== "undefined";
  }

  onStatus(cb: (status: VoiceStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (!this.isSupported()) {
      this.status = "disabled";
      this.broadcast();
      return;
    }
    if (this.status === "recording") return;

    this.status = "recording";
    this.broadcast();
    this.timer = window.setTimeout(() => {
      const text = "（语音转文本占位）我现在有点累";
      inputBus.emit("voice_input", { text });
      chatService.sendText(text);
      this.status = "idle";
      this.broadcast();
    }, 2000);
  }

  stop(): void {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.status = this.isSupported() ? "idle" : "disabled";
    this.broadcast();
  }

  private broadcast(): void {
    this.listeners.forEach((cb) => cb(this.status));
  }
}

export const voiceInput = new VoiceInput();
