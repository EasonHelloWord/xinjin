import { inputBus } from "../events/inputBus";
import { StateVisualInput } from "../state/types";

// 视频输入通道：把视频分析结果（或 mock 提示）发到事件总线。
export class VideoInputChannel {
  // partialState 支持只更新部分字段。
  emitHint(partialState: Partial<StateVisualInput>): void {
    inputBus.emit("video_state_hint", { partialState });
  }
}

// 单例导出。
export const videoInputChannel = new VideoInputChannel();
