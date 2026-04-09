import { api } from "../lib/api";

export type VoiceStatus = "idle" | "connecting" | "recording" | "disabled";

interface VoiceMeter {
  level: number;
  bins: Uint8Array<ArrayBuffer>;
}

type SpeechRecognitionResultLike = ArrayLike<{ transcript?: string }> & { isFinal?: boolean };
type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  lang?: string;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const mergeTranscript = (base: string, delta: string): string => {
  const a = base.trim();
  const b = delta.trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b || a.endsWith(b)) return a;
  const maxOverlap = Math.min(a.length, b.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (a.slice(-overlap) === b.slice(0, overlap)) {
      return `${a}${b.slice(overlap)}`.replace(/\s+/g, " ").trim();
    }
  }
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
};

export class VoiceInput {
  private status: VoiceStatus = "idle";
  private statusListeners = new Set<(status: VoiceStatus) => void>();
  private meterListeners = new Set<(meter: VoiceMeter) => void>();
  private transcriptListeners = new Set<(text: string, isFinal: boolean) => void>();

  private recognition: SpeechRecognitionLike | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;

  private lastEmitted = "";
  private recorderTranscript = "";
  private recorderSessionId = 0;
  private transcribeQueue: Promise<void> = Promise.resolve();

  private getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === "undefined") return null;
    const maybeCtor =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (typeof maybeCtor !== "function") return null;
    return maybeCtor as SpeechRecognitionCtor;
  }

  isSupported(): boolean {
    const speech = this.getSpeechRecognitionCtor();
    if (speech) return true;
    return (
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
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

  onTranscript(cb: (text: string, isFinal: boolean) => void): () => void {
    this.transcriptListeners.add(cb);
    return () => this.transcriptListeners.delete(cb);
  }

  async start(): Promise<void> {
    if (!this.isSupported()) {
      this.status = "disabled";
      this.broadcastStatus();
      return;
    }
    if (this.status === "connecting" || this.status === "recording") return;

    this.lastEmitted = "";
    this.recorderTranscript = "";
    this.recorderSessionId += 1;
    this.status = "connecting";
    this.broadcastStatus();

    const speechCtor = this.getSpeechRecognitionCtor();
    if (speechCtor) {
      await this.startSpeechRecognition(speechCtor);
      return;
    }
    await this.startRecorderFallback();
  }

  stop(): void {
    if (this.status === "idle" || this.status === "disabled") return;
    this.cleanup();
    this.status = this.isSupported() ? "idle" : "disabled";
    this.broadcastStatus();
  }

  private async startSpeechRecognition(Ctor: SpeechRecognitionCtor): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const recognition = new Ctor();
        this.recognition = recognition;

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = (navigator.language || "zh-CN").trim() || "zh-CN";

        recognition.onstart = () => resolve();
        recognition.onresult = (event) => this.handleSpeechResult(event);
        recognition.onerror = (event) => {
          if (this.status === "connecting") {
            reject(new Error(event.error || "speech recognition error"));
            return;
          }
          this.stop();
        };
        recognition.onend = () => {
          if (this.status === "recording" || this.status === "connecting") {
            this.stop();
          }
        };

        try {
          recognition.start();
        } catch (err) {
          reject(err as Error);
        }
      });
      this.status = "recording";
      this.broadcastStatus();
    } catch {
      this.cleanup();
      this.status = this.isSupported() ? "idle" : "disabled";
      this.broadcastStatus();
    }
  }

  private async startRecorderFallback(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.mediaStream = stream;

      const mimeType = this.pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.mediaRecorder = recorder;
      const sessionId = this.recorderSessionId;
      const language = (navigator.language || "zh-CN").trim() || "zh-CN";

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size <= 0) return;
        const audioBlob = event.data;
        this.transcribeQueue = this.transcribeQueue
          .then(async () => {
            if (sessionId !== this.recorderSessionId) return;
            const base64 = await this.blobToBase64(audioBlob);
            const result = await api.transcribeVoice(base64, audioBlob.type || mimeType || "audio/webm", language);
            const text = (result.text || "").trim();
            if (!text || sessionId !== this.recorderSessionId) return;
            this.recorderTranscript = mergeTranscript(this.recorderTranscript, text);
            this.emitTranscript(this.recorderTranscript, false);
          })
          .catch(() => {
            // Ignore chunk-level failures and continue next chunks.
          });
      };

      recorder.onstop = () => {
        const sid = sessionId;
        void this.transcribeQueue.finally(() => {
          if (sid !== this.recorderSessionId) return;
          if (this.recorderTranscript.trim()) {
            this.emitTranscript(this.recorderTranscript, true);
          }
        });
      };

      recorder.start(1200);
      this.status = "recording";
      this.broadcastStatus();
    } catch {
      this.cleanup();
      this.status = this.isSupported() ? "idle" : "disabled";
      this.broadcastStatus();
    }
  }

  private handleSpeechResult(event: SpeechRecognitionEventLike): void {
    let finalText = "";
    let interimText = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript?.trim();
      if (!transcript) continue;
      if (result.isFinal) finalText += finalText ? ` ${transcript}` : transcript;
      else interimText += interimText ? ` ${transcript}` : transcript;
    }

    const combined = [finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!combined) return;
    const isFinal = interimText.length === 0 && finalText.length > 0;
    this.emitTranscript(combined, isFinal);
  }

  private emitTranscript(text: string, isFinal: boolean): void {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (normalized === this.lastEmitted && !isFinal) return;
    this.lastEmitted = normalized;
    this.transcriptListeners.forEach((cb) => cb(normalized, isFinal));
  }

  private pickMimeType(): string | null {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return null;
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private cleanup(): void {
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      try {
        this.recognition.abort?.();
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.recognition = null;

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    this.mediaStream = null;

    this.recorderSessionId += 1;
    this.recorderTranscript = "";
    this.lastEmitted = "";
    this.meterListeners.forEach((cb) =>
      cb({
        level: 0,
        bins: new Uint8Array(0) as Uint8Array<ArrayBuffer>
      })
    );
  }

  private broadcastStatus(): void {
    this.statusListeners.forEach((cb) => cb(this.status));
  }
}

export const voiceInput = new VoiceInput();

