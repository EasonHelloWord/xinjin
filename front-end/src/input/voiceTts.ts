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
    format?: string;
    sampleRate?: number;
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
  private format = "pcm";

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
          this.handleAudioChunk(event.data);
          return;
        }
        if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buf) => this.handleAudioChunk(buf));
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

    if (parsed.type === "tts_meta") {
      const fmt = (parsed.payload?.format || "").trim().toLowerCase();
      if (fmt) this.format = fmt;
      const sr = Number(parsed.payload?.sampleRate);
      if (Number.isFinite(sr) && sr > 3000) this.sampleRate = sr;
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

  private handleAudioChunk(buf: ArrayBuffer): void {
    if (this.format === "pcm") {
      this.playPcmChunk(buf);
      return;
    }
    void this.playEncodedChunk(buf);
  }

  private async playEncodedChunk(buf: ArrayBuffer): Promise<void> {
    if (!buf.byteLength) return;
    const ctx = this.ensureAudioContext();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // wait for next user gesture
      }
    }
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextPlayAt);
    source.start(startAt);
    this.nextPlayAt = startAt + decoded.duration;
  }

  private playPcmChunk(buf: ArrayBuffer): void {
    if (buf.byteLength < 2) return;
    const ctx = this.ensureAudioContext();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    const samples = Math.floor(buf.byteLength / 2);
    if (samples <= 0) return;
    const view = new DataView(buf);
    const f32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      f32[i] = view.getInt16(i * 2, true) / 32768;
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
        text: normalized,
        format: this.format,
        sampleRate: this.sampleRate
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
