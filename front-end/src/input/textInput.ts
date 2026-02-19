import { inputBus } from "../events/inputBus";

// 文本输入通道：统一把文本输入发到事件总线。
export class TextInputChannel {
  // 外部只需要调用 send，内部会转成 text_input 事件。
  send(text: string): void {
    inputBus.emit("text_input", { text });
  }
}

// 单例导出。
export const textInputChannel = new TextInputChannel();
