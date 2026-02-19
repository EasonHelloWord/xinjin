import { inputBus } from "../events/inputBus";

export class TextInputChannel {
  send(text: string): void {
    inputBus.emit("text_input", { text });
  }
}

export const textInputChannel = new TextInputChannel();
