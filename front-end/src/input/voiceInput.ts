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

export class VoiceInput {
  private status: VoiceStatus = "idle";
  private statusListeners = new Set<(status: VoiceStatus) => void>();
  private meterListeners = new Set<(meter: VoiceMeter) => void>();
  private transcriptListeners = new Set<(text: string, isFinal: boolean) => void>();
  private recognition: SpeechRecognitionLike | null = null;
  private lastEmitted = "";

  private getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === "undefined") return null;
    const maybeCtor =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (typeof maybeCtor !== "function") return null;
    return maybeCtor as SpeechRecognitionCtor;
  }

  isSupported(): boolean {
    return this.getSpeechRecognitionCtor() !== null;
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
    this.status = "connecting";
    this.broadcastStatus();

    const Ctor = this.getSpeechRecognitionCtor();
    if (!Ctor) {
      this.status = "disabled";
      this.broadcastStatus();
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const recognition = new Ctor();
        this.recognition = recognition;

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = (navigator.language || "zh-CN").trim() || "zh-CN";

        recognition.onstart = () => resolve();
        recognition.onresult = (event) => this.handleResult(event);
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

  stop(): void {
    if (this.status === "idle" || this.status === "disabled") return;
    this.cleanup();
    this.status = this.isSupported() ? "idle" : "disabled";
    this.broadcastStatus();
  }

  private handleResult(event: SpeechRecognitionEventLike): void {
    let finalText = "";
    let interimText = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result?.[0]?.transcript?.trim();
      if (!transcript) continue;
      if (result.isFinal) {
        finalText += finalText ? ` ${transcript}` : transcript;
      } else {
        interimText += interimText ? ` ${transcript}` : transcript;
      }
    }
    const combined = [finalText, interimText].filter(Boolean).join(" ").trim();
    if (!combined || combined === this.lastEmitted) return;
    this.lastEmitted = combined;
    const isFinal = interimText.length === 0 && finalText.length > 0;
    this.transcriptListeners.forEach((cb) => cb(combined, isFinal));
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
