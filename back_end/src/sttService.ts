import OpenAI from "openai";
import { toFile } from "openai/uploads";

type TranscribeOptions = {
  audioBase64: string;
  mimeType?: string;
  language?: string;
};

const STT_API_KEY = (): string =>
  (process.env.STT_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const STT_BASE_URL = (): string =>
  (process.env.STT_BASE_URL || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
const STT_MODEL = (): string => (process.env.STT_MODEL || "gpt-4o-mini-transcribe").trim();

const extFromMime = (mime: string): string => {
  const lower = mime.toLowerCase();
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mp4")) return "mp4";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  return "webm";
};

const normalizeLanguage = (language?: string): string | undefined => {
  const lang = (language || "").trim();
  if (!lang) return undefined;
  return lang.split("-")[0]?.toLowerCase() || undefined;
};

export const hasSttConfig = (): boolean => STT_API_KEY().length > 0;

export const transcribeAudioBase64 = async (options: TranscribeOptions): Promise<string> => {
  if (!hasSttConfig()) {
    throw new Error("语音转写未配置（缺少 STT_API_KEY/LLM_API_KEY/OPENAI_API_KEY）");
  }

  const normalizedBase64 = options.audioBase64.replace(/^data:[^;]+;base64,/, "").trim();
  const audioBuffer = Buffer.from(normalizedBase64, "base64");
  if (!audioBuffer.length) return "";

  const mimeType = (options.mimeType || "audio/webm").trim() || "audio/webm";
  const file = await toFile(audioBuffer, `speech.${extFromMime(mimeType)}`, { type: mimeType });
  const client = new OpenAI({
    apiKey: STT_API_KEY(),
    baseURL: STT_BASE_URL()
  });

  const res = await client.audio.transcriptions.create({
    model: STT_MODEL(),
    file,
    ...(normalizeLanguage(options.language) ? { language: normalizeLanguage(options.language) } : {})
  });

  return (res.text || "").trim();
};

