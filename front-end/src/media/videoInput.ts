import { videoInputChannel } from "../input/videoInputChannel";

// 摄像头权限状态。
export type VideoPermission = "idle" | "granted" | "denied";
// 视频模块运行状态。
export type VideoStatus = "stopped" | "running";

// 视频输入模块：当前仅做权限检测和 mock 状态提示，不进行真实流处理。
export class VideoInput {
  permission: VideoPermission = "idle";
  status: VideoStatus = "stopped";
  private listeners = new Set<(state: { permission: VideoPermission; status: VideoStatus }) => void>();

  // 订阅权限/运行状态变化。
  onState(cb: (state: { permission: VideoPermission; status: VideoStatus }) => void): () => void {
    this.listeners.add(cb);
    cb({ permission: this.permission, status: this.status });
    return () => this.listeners.delete(cb);
  }

  // 请求摄像头权限。
  async requestPermission(): Promise<VideoPermission> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.permission = "denied";
      this.broadcast();
      return this.permission;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      this.permission = "granted";
    } catch {
      this.permission = "denied";
    }
    this.broadcast();
    return this.permission;
  }

  // 启动视频输入（mock：延迟后发送随机状态提示）。
  start(): void {
    this.status = "running";
    this.broadcast();
    window.setTimeout(() => {
      videoInputChannel.emitHint({
        arousal: 0.55 + Math.random() * 0.25,
        valence: 0.35 + Math.random() * 0.4
      });
    }, 400);
  }

  // 停止视频输入。
  stop(): void {
    this.status = "stopped";
    this.broadcast();
  }

  // 广播状态给 UI。
  private broadcast(): void {
    const payload = { permission: this.permission, status: this.status };
    this.listeners.forEach((cb) => cb(payload));
  }
}

// 单例导出。
export const videoInput = new VideoInput();
