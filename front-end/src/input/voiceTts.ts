import { APP_CONFIG } from "../config";

type PendingSpeak = {
  resolve: () => void;
  reject: (err: Error) => void;
};

type VoiceEnvelope = {
  type?: string;
  payload?: {
    requestId?: string;
    message?: string;
  };
};

const makeReqId = (): string => `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class VoiceTts {
  private ws: WebSocket | null = null;
  private ready = false;
  private connectPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingSpeak>();
  private audioContext: AudioContext | null = null;
  private nextPlayAt = 0;
  private sampleRate = 16000;

  private async ensureSocket(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.ready) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(APP_CONFIG.voiceStreamUrl);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        resolve();
      };

      ws.onerror = () => {
        reject(new Error("TTS websocket error"));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleTextFrame(event.data);
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          this.playPcmChunk(event.data);
          return;
        }
        if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buf) => this.playPcmChunk(buf));
        }
      };

      ws.onclose = () => {
        this.ready = false;
        this.ws = null;
      };
    })
      .then(() => {
        this.connectPromise = null;
      })
      .catch((err) => {
        this.connectPromise = null;
        throw err;
      });

    return this.connectPromise;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      this.nextPlayAt = this.audioContext.currentTime;
    }
    return this.audioContext;
  }

  private handleTextFrame(text: string): void {
    let parsed: VoiceEnvelope | null = null;
    try {
      parsed = JSON.parse(text) as VoiceEnvelope;
    } catch {
      return;
    }
    if (!parsed?.type) return;

    if (parsed.type === "voice_ready") {
      this.ready = true;
      return;
    }

    if (parsed.type === "tts_done") {
      const rid = parsed.payload?.requestId || "";
      const pending = this.pending.get(rid);
      if (pending) {
        pending.resolve();
        this.pending.delete(rid);
      }
      return;
    }

    if (parsed.type === "tts_error") {
      const rid = parsed.payload?.requestId || "";
      const message = parsed.payload?.message || "TTS failed";
      if (rid) {
        const pending = this.pending.get(rid);
        if (pending) {
          pending.reject(new Error(message));
          this.pending.delete(rid);
        }
      }
    }
  }

  private playPcmChunk(buf: ArrayBuffer): void {
    if (buf.byteLength < 2) return;
    const ctx = this.ensureAudioContext();
    const i16 = new Int16Array(buf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) {
      f32[i] = i16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, f32.length, this.sampleRate);
    audioBuffer.copyToChannel(f32, 0, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextPlayAt);
    source.start(startAt);
    this.nextPlayAt = startAt + audioBuffer.duration;
  }

  async speak(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) return;
    await this.ensureSocket();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("TTS websocket is not connected");
    }

    const requestId = makeReqId();
    const done = new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    ws.send(
      JSON.stringify({
        action: "tts_speak",
        requestId,
        text: normalized
      })
    );

    const timeout = window.setTimeout(() => {
      const pending = this.pending.get(requestId);
      if (pending) {
        pending.reject(new Error("TTS timeout"));
        this.pending.delete(requestId);
      }
    }, 60_000);

    try {
      await done;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            action: "tts_stop",
            requestId: makeReqId()
          })
        );
      } catch {
        // ignore
      }
    }
    this.nextPlayAt = this.audioContext?.currentTime || 0;
  }
}

export const voiceTts = new VoiceTts();
