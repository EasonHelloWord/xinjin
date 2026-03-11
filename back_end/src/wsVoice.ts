import type { FastifyInstance } from "fastify";
import WebSocket, { RawData } from "ws";
import { randomUUID } from "node:crypto";
import { ServerMessage } from "./protocol";
import { nowTs } from "./utils";

type VoicePayload = Record<string, unknown>;

const send = <TPayload extends VoicePayload>(socket: WebSocket, type: string, payload: TPayload): void => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: ServerMessage<TPayload> = {
    v: 1,
    type,
    ts: nowTs(),
    payload
  };
  socket.send(JSON.stringify(message));
};

const env = (name: string, fallback = ""): string => (process.env[name] || fallback).trim();
const makeAliyunId = (): string => randomUUID().replace(/-/g, "");

const TTS_WS_URL = env("ALIYUN_TTS_WS_URL", "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1");
const TTS_APP_KEY = env("ALIYUN_NLS_APP_KEY");
const TTS_TOKEN = env("ALIYUN_NLS_TOKEN");
const TTS_VOICE = env("ALIYUN_TTS_VOICE", "xiaoyun");
const TTS_FORMAT = env("ALIYUN_TTS_FORMAT", "pcm");
const TTS_SAMPLE_RATE = Number(env("ALIYUN_TTS_SAMPLE_RATE", "16000")) || 16000;
const TTS_VOLUME = Number(env("ALIYUN_TTS_VOLUME", "50")) || 50;
const TTS_SPEECH_RATE = Number(env("ALIYUN_TTS_SPEECH_RATE", "0")) || 0;
const TTS_PITCH_RATE = Number(env("ALIYUN_TTS_PITCH_RATE", "0")) || 0;

const hasAliyunTtsConfig = (): boolean => Boolean(TTS_APP_KEY && TTS_TOKEN);

type TtsAction = "tts_speak" | "tts_start" | "tts_text" | "tts_stop";
type TtsCommand = {
  action: TtsAction;
  requestId?: string;
  text?: string;
  voice?: string;
  format?: string;
  sampleRate?: number;
};

type UpstreamMessage = {
  header?: {
    name?: string;
    status?: number;
    status_text?: string;
    task_id?: string;
  };
  payload?: {
    message?: string;
    code?: string;
    status?: number;
    status_text?: string;
    index?: number;
    text?: string;
  };
};

class AliyunTtsSession {
  private upstream: WebSocket | null = null;
  private taskId = makeAliyunId();
  private activeRequestId = "";
  private activeVoice = TTS_VOICE;
  private activeFormat = TTS_FORMAT;
  private activeSampleRate = TTS_SAMPLE_RATE;
  private started = false;
  private startWaiter: {
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(private readonly fastify: FastifyInstance, private readonly downstream: WebSocket) {}

  private sendUpstreamFrame(name: "StartSynthesis" | "RunSynthesis" | "StopSynthesis", payload: Record<string, unknown>): void {
    if (!this.upstream || this.upstream.readyState !== WebSocket.OPEN) return;
    const frame = {
      header: {
        appkey: TTS_APP_KEY,
        token: TTS_TOKEN,
        message_id: makeAliyunId(),
        task_id: this.taskId,
        namespace: "FlowingSpeechSynthesizer",
        name
      },
      payload
    };
    this.upstream.send(JSON.stringify(frame));
  }

  private bindUpstreamEvents(upstream: WebSocket): void {
    upstream.on("message", (raw: RawData, isBinary: boolean) => {
      if (this.downstream.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        this.downstream.send(raw, { binary: true });
        return;
      }

      const text =
        typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
      let parsed: UpstreamMessage | null = null;
      try {
        parsed = JSON.parse(text) as UpstreamMessage;
      } catch {
        parsed = null;
      }

      const name = parsed?.header?.name || "";
      if (name === "SynthesisStarted") {
        this.started = true;
        if (this.startWaiter) {
          clearTimeout(this.startWaiter.timer);
          this.startWaiter.resolve();
          this.startWaiter = null;
        }
        send(this.downstream, "tts_started", { requestId: this.activeRequestId });
        send(this.downstream, "tts_meta", {
          provider: "aliyun",
          voice: this.activeVoice,
          format: this.activeFormat,
          sampleRate: this.activeSampleRate
        });
        return;
      }
      if (name === "SentenceSynthesis") {
        send(this.downstream, "tts_sentence", {
          requestId: this.activeRequestId,
          index: parsed?.payload?.index ?? null,
          text: parsed?.payload?.text ?? ""
        });
        return;
      }
      if (name === "SynthesisCompleted") {
        send(this.downstream, "tts_done", { requestId: this.activeRequestId });
        return;
      }
      if (name === "TaskFailed") {
        const details =
          parsed?.payload?.message ||
          parsed?.payload?.status_text ||
          parsed?.header?.status_text ||
          "Aliyun TTS task failed";
        if (this.startWaiter) {
          clearTimeout(this.startWaiter.timer);
          this.startWaiter.reject(new Error(details));
          this.startWaiter = null;
        }
        send(this.downstream, "tts_error", {
          requestId: this.activeRequestId,
          message: details,
          status: parsed?.header?.status ?? parsed?.payload?.status ?? null,
          code: parsed?.payload?.code ?? null
        });
      }
    });

    upstream.on("error", (err) => {
      this.fastify.log.error({ err }, "Aliyun TTS upstream error");
      if (this.startWaiter) {
        clearTimeout(this.startWaiter.timer);
        this.startWaiter.reject(err instanceof Error ? err : new Error("Aliyun TTS upstream error"));
        this.startWaiter = null;
      }
      send(this.downstream, "tts_error", {
        requestId: this.activeRequestId,
        message: "Aliyun TTS upstream error"
      });
    });

    upstream.on("close", () => {
      this.upstream = null;
      this.started = false;
    });
  }

  private async ensureUpstream(
    requestId: string,
    opts: { voice?: string; format?: string; sampleRate?: number }
  ): Promise<void> {
    if (this.upstream && this.upstream.readyState === WebSocket.OPEN && this.started) return;

    this.taskId = makeAliyunId();
    this.activeRequestId = requestId;
    this.started = false;
    this.activeVoice = opts.voice || TTS_VOICE;
    this.activeFormat = opts.format || TTS_FORMAT;
    this.activeSampleRate = Number(opts.sampleRate) || TTS_SAMPLE_RATE;
    const joinTokenToUrl = (base: string, token: string): string => {
      if (!token) return base;
      if (base.includes("token=")) return base;
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}token=${encodeURIComponent(token)}`;
    };
    const upstreamUrl = joinTokenToUrl(TTS_WS_URL, TTS_TOKEN);
    const upstream = new WebSocket(upstreamUrl);
    this.upstream = upstream;
    this.bindUpstreamEvents(upstream);

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        upstream.off("error", onError);
        resolve();
      };
      const onError = (err: Error): void => {
        upstream.off("open", onOpen);
        reject(err);
      };
      upstream.once("open", onOpen);
      upstream.once("error", onError);
    });

    this.sendUpstreamFrame("StartSynthesis", {
      voice: this.activeVoice,
      format: this.activeFormat,
      sample_rate: this.activeSampleRate,
      volume: TTS_VOLUME,
      speech_rate: TTS_SPEECH_RATE,
      pitch_rate: TTS_PITCH_RATE
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.startWaiter) {
          this.startWaiter = null;
          reject(new Error("Aliyun TTS start timeout"));
        }
      }, 10_000);
      this.startWaiter = { resolve, reject, timer };
    });
  }

  async handle(command: TtsCommand): Promise<void> {
    if (!hasAliyunTtsConfig()) {
      send(this.downstream, "tts_error", {
        requestId: command.requestId || "",
        message: "Aliyun TTS is not configured"
      });
      return;
    }

    const requestId = command.requestId || randomUUID();
    this.activeRequestId = requestId;

    if (command.action === "tts_start") {
      await this.ensureUpstream(requestId, command);
      return;
    }

    if (command.action === "tts_text") {
      await this.ensureUpstream(requestId, command);
      if ((command.text || "").trim()) {
        this.sendUpstreamFrame("RunSynthesis", { text: command.text });
      }
      return;
    }

    if (command.action === "tts_stop") {
      if (this.upstream && this.upstream.readyState === WebSocket.OPEN) {
        this.sendUpstreamFrame("StopSynthesis", {});
      }
      return;
    }

    if (command.action === "tts_speak") {
      await this.ensureUpstream(requestId, command);
      if ((command.text || "").trim()) {
        this.sendUpstreamFrame("RunSynthesis", { text: command.text });
      }
      this.sendUpstreamFrame("StopSynthesis", {});
    }
  }

  close(): void {
    if (this.upstream) {
      try {
        if (this.upstream.readyState === WebSocket.OPEN) {
          this.sendUpstreamFrame("StopSynthesis", {});
        }
        this.upstream.close();
      } catch {
        // ignore
      }
      this.upstream = null;
    }
  }
}

const decodeTextMessage = (raw: RawData): string => {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return "";
};

export const registerVoiceWs = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get("/voice", { websocket: true }, (socket) => {
    send(socket, "voice_ready", {
      mode: hasAliyunTtsConfig() ? "aliyun_tts+placeholder_asr" : "placeholder",
      tts: {
        provider: hasAliyunTtsConfig() ? "aliyun" : "none",
        voice: TTS_VOICE,
        format: TTS_FORMAT,
        sampleRate: TTS_SAMPLE_RATE
      }
    });
    const ttsSession = new AliyunTtsSession(fastify, socket);

    socket.on("message", async (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        // Keep existing placeholder ASR path for microphone packets.
        send(socket, "voice_transcript", {
          text: "\uff08\u8bed\u97f3\u8f6c\u6587\u672c\u5360\u4f4d\uff09\u6211\u73b0\u5728\u6709\u70b9\u7d2f\u3002"
        });
        send(socket, "suggested_preset", {
          name: "tired"
        });
        return;
      }

      const text = decodeTextMessage(raw);
      if (!text.trim()) return;

      let parsed: TtsCommand | null = null;
      try {
        parsed = JSON.parse(text) as TtsCommand;
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.action || !String(parsed.action).startsWith("tts_")) return;

      try {
        await ttsSession.handle(parsed);
      } catch (err) {
        fastify.log.error({ err }, "Voice TTS command failed");
        send(socket, "tts_error", {
          requestId: parsed.requestId || "",
          message: "Voice TTS command failed"
        });
      }
    });

    socket.on("error", (err: Error) => {
      fastify.log.error({ err }, "Voice websocket error");
      send(socket, "error", {
        code: "INTERNAL",
        message: "Voice channel internal error"
      });
    });

    socket.on("close", () => {
      ttsSession.close();
    });
  });
};
