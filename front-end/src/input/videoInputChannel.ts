import { inputBus } from "../events/inputBus";
import { StateVisualInput } from "../state/types";

export class VideoInputChannel {
  emitHint(partialState: Partial<StateVisualInput>): void {
    inputBus.emit("video_state_hint", { partialState });
  }
}

export const videoInputChannel = new VideoInputChannel();
