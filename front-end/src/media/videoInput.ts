import { videoInputChannel } from "../input/videoInputChannel";

export type VideoPermission = "idle" | "granted" | "denied";
export type VideoStatus = "stopped" | "running";

export class VideoInput {
  permission: VideoPermission = "idle";
  status: VideoStatus = "stopped";
  private listeners = new Set<(state: { permission: VideoPermission; status: VideoStatus }) => void>();

  onState(cb: (state: { permission: VideoPermission; status: VideoStatus }) => void): () => void {
    this.listeners.add(cb);
    cb({ permission: this.permission, status: this.status });
    return () => this.listeners.delete(cb);
  }

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

  stop(): void {
    this.status = "stopped";
    this.broadcast();
  }

  private broadcast(): void {
    const payload = { permission: this.permission, status: this.status };
    this.listeners.forEach((cb) => cb(payload));
  }
}

export const videoInput = new VideoInput();
