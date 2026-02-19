import { APP_CONFIG } from "../config";

export type VoiceStatus = "idle" | "connecting" | "recording" | "disabled";

interface VoiceMeter {
  level: number;
  bins: Uint8Array<ArrayBuffer>;
}

export class VoiceInput {
  private status: VoiceStatus = "idle";
  private statusListeners = new Set<(status: VoiceStatus) => void>();
  private meterListeners = new Set<(meter: VoiceMeter) => void>();
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuffer: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined" &&
      typeof WebSocket !== "undefined"
    );
  }

  onStatus(cb: (status: VoiceStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  onMeter(cb: (meter: VoiceMeter) => void): () => void {
    this.meterListeners.add(cb);
    return () => this.meterListeners.delete(cb);
  }

  async start(): Promise<void> {
    if (!this.isSupported()) {
      this.status = "disabled";
      this.broadcastStatus();
      return;
    }
    if (this.status === "connecting" || this.status === "recording") return;

    this.status = "connecting";
    this.broadcastStatus();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.setupMeter(this.mediaStream);
      await this.openSocket();
      this.startRecorder(this.mediaStream);
      this.status = "recording";
      this.broadcastStatus();
    } catch {
      this.cleanup();
      this.status = this.isSupported() ? "idle" : "disabled";
      this.broadcastStatus();
    }
  }

  stop(): void {
    if (this.status === "idle" || this.status === "disabled") return;
    this.cleanup();
    this.status = this.isSupported() ? "idle" : "disabled";
    this.broadcastStatus();
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(APP_CONFIG.voiceStreamUrl);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("voice socket error"));
      ws.onclose = () => {
        if (this.status === "recording" || this.status === "connecting") {
          this.stop();
        }
      };
    });
  }

  private startRecorder(stream: MediaStream): void {
    const preferred = this.pickMimeType();
    this.mediaRecorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0 || this.ws?.readyState !== WebSocket.OPEN) return;
      void event.data.arrayBuffer().then((buf) => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
      });
    };
    this.mediaRecorder.start(200);
  }

  private pickMimeType(): string | null {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return null;
  }

  private setupMeter(stream: MediaStream): void {
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.78;
    source.connect(this.analyser);
    this.meterBuffer = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const tick = (): void => {
      if (!this.analyser || !this.meterBuffer) return;
      this.analyser.getByteFrequencyData(this.meterBuffer);
      let sum = 0;
      for (let i = 0; i < this.meterBuffer.length; i++) sum += this.meterBuffer[i];
      const level = sum / (this.meterBuffer.length * 255);
      const bins = new Uint8Array(this.meterBuffer.length) as Uint8Array<ArrayBuffer>;
      bins.set(this.meterBuffer);
      this.meterListeners.forEach((cb) => cb({ level, bins }));
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  private cleanup(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    this.mediaStream = null;

    if (this.audioContext) {
      void this.audioContext.close();
    }
    this.audioContext = null;
    this.analyser = null;
    this.meterBuffer = null;
  }

  private broadcastStatus(): void {
    this.statusListeners.forEach((cb) => cb(this.status));
  }
}

export const voiceInput = new VoiceInput();
