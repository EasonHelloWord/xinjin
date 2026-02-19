import { inputBus } from "../events/inputBus";
import { chatService } from "../chat/chatService";

// 语音状态：当前是 mock 录音流程。
export type VoiceStatus = "idle" | "recording" | "disabled";

// 语音输入模块：模拟“录音 -> 转文字 -> 发聊天”。
export class VoiceInput {
  private status: VoiceStatus = "idle";
  private timer: number | null = null;
  private listeners = new Set<(status: VoiceStatus) => void>();

  // 浏览器环境检查（后续可替换为真实语音能力检测）。
  isSupported(): boolean {
    return typeof window !== "undefined";
  }

  // 监听语音状态变化。
  onStatus(cb: (status: VoiceStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  // 开始录音（mock：2 秒后返回一段占位文本）。
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

  // 手动停止录音并恢复 idle。
  stop(): void {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.status = this.isSupported() ? "idle" : "disabled";
    this.broadcast();
  }

  // 通知所有订阅者刷新状态 UI。
  private broadcast(): void {
    this.listeners.forEach((cb) => cb(this.status));
  }
}

// 单例导出。
export const voiceInput = new VoiceInput();
