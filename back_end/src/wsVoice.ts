import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import OpenAI from "openai";
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

const TTS_PROVIDER = env("TTS_PROVIDER", "openai").toLowerCase();
const OPENAI_API_KEY = env("OPENAI_API_KEY");
const OPENAI_BASE_URL = env("OPENAI_BASE_URL", "https://api.openai.com/v1");
const OPENAI_TTS_MODEL = env("OPENAI_TTS_MODEL", "gpt-4o-mini-tts");
const OPENAI_TTS_VOICE = env("OPENAI_TTS_VOICE", "alloy");
const OPENAI_TTS_FORMAT = env("OPENAI_TTS_FORMAT", "pcm");
const OPENAI_TTS_SAMPLE_RATE = Number(env("OPENAI_TTS_SAMPLE_RATE", "24000")) || 24000;
const OPENAI_TTS_INSTRUCTIONS = env("OPENAI_TTS_INSTRUCTIONS");

const hasOpenAiTtsConfig = (): boolean => Boolean(OPENAI_API_KEY) && TTS_PROVIDER === "openai";

let openaiClient: OpenAI | null = null;
const getOpenAiClient = (): OpenAI => {
  if (!hasOpenAiTtsConfig()) {
    throw new Error("OpenAI TTS is not configured");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: OPENAI_API_KEY,
      baseURL: OPENAI_BASE_URL
    });
  }
  return openaiClient;
};

type TtsAction = "tts_speak" | "tts_start" | "tts_text" | "tts_stop";
type TtsCommand = {
  action: TtsAction;
  requestId?: string;
  text?: string;
  voice?: string;
  format?: string;
  sampleRate?: number;
};

const decodeTextMessage = (raw: RawData): string => {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return "";
};

class OpenAiTtsSession {
  private stagedText = "";
  private stagedRequestId = "";
  private stagedVoice = OPENAI_TTS_VOICE;
  private stagedFormat = OPENAI_TTS_FORMAT;
  private stagedSampleRate = OPENAI_TTS_SAMPLE_RATE;

  constructor(private readonly fastify: FastifyInstance, private readonly downstream: WebSocket) {}

  private async synthesize(requestId: string, text: string, opts: { voice?: string; format?: string; sampleRate?: number }): Promise<void> {
    if (!hasOpenAiTtsConfig()) {
      send(this.downstream, "tts_error", {
        requestId,
        message: "OpenAI TTS is not configured"
      });
      return;
    }

    const input = text.trim();
    if (!input) {
      send(this.downstream, "tts_done", { requestId });
      return;
    }

    const voice = (opts.voice || OPENAI_TTS_VOICE).trim();
    const format = (opts.format || OPENAI_TTS_FORMAT).trim().toLowerCase();
    const sampleRate = Number(opts.sampleRate) || OPENAI_TTS_SAMPLE_RATE;

    try {
      send(this.downstream, "tts_started", { requestId });
      send(this.downstream, "tts_meta", {
        provider: "openai",
        voice,
        format,
        sampleRate
      });

      const client = getOpenAiClient();
      const response = await client.audio.speech.create({
        model: OPENAI_TTS_MODEL,
        voice,
        input,
        response_format: format as "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm",
        ...(OPENAI_TTS_INSTRUCTIONS ? { instructions: OPENAI_TTS_INSTRUCTIONS } : {})
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (this.downstream.readyState === this.downstream.OPEN) {
        this.downstream.send(bytes, { binary: true });
      }
      send(this.downstream, "tts_done", { requestId });
    } catch (err) {
      this.fastify.log.error({ err }, "OpenAI TTS synthesize failed");
      send(this.downstream, "tts_error", {
        requestId,
        message: err instanceof Error ? err.message : "OpenAI TTS synthesize failed"
      });
    }
  }

  async handle(command: TtsCommand): Promise<void> {
    const requestId = command.requestId || randomUUID().replace(/-/g, "");

    if (command.action === "tts_speak") {
      await this.synthesize(requestId, command.text || "", command);
      return;
    }

    if (command.action === "tts_start") {
      this.stagedText = "";
      this.stagedRequestId = requestId;
      this.stagedVoice = command.voice || OPENAI_TTS_VOICE;
      this.stagedFormat = command.format || OPENAI_TTS_FORMAT;
      this.stagedSampleRate = Number(command.sampleRate) || OPENAI_TTS_SAMPLE_RATE;
      send(this.downstream, "tts_started", { requestId });
      send(this.downstream, "tts_meta", {
        provider: "openai",
        voice: this.stagedVoice,
        format: this.stagedFormat,
        sampleRate: this.stagedSampleRate
      });
      return;
    }

    if (command.action === "tts_text") {
      if (!this.stagedRequestId) this.stagedRequestId = requestId;
      this.stagedText += command.text || "";
      return;
    }

    if (command.action === "tts_stop") {
      const rid = this.stagedRequestId || requestId;
      const text = this.stagedText;
      const opts = {
        voice: this.stagedVoice,
        format: this.stagedFormat,
        sampleRate: this.stagedSampleRate
      };
      this.stagedRequestId = "";
      this.stagedText = "";
      await this.synthesize(rid, text, opts);
    }
  }
}

export const registerVoiceWs = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get("/voice", { websocket: true }, (socket) => {
    send(socket, "voice_ready", {
      mode: hasOpenAiTtsConfig() ? "openai_tts+placeholder_asr" : "placeholder",
      provider: hasOpenAiTtsConfig() ? "openai" : "none",
      voice: OPENAI_TTS_VOICE,
      format: OPENAI_TTS_FORMAT,
      sampleRate: OPENAI_TTS_SAMPLE_RATE
    });
    const ttsSession = new OpenAiTtsSession(fastify, socket);

    socket.on("message", async (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        // Keep placeholder ASR path.
        send(socket, "voice_transcript", {
          text: "（语音转文本占位）我现在有点累。"
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
          message: err instanceof Error ? err.message : "Voice TTS command failed"
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

  });
};
