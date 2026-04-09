import OpenAI from "openai";
import { hasLlmConfig, llmChat } from "./providers/llmClient";

type TtsChunk = {
  data: string;
  seq: number;
};

type PreparedSpeech = {
  speakText: string;
  style: string;
  styledText: string;
};

type StreamTtsOptions = {
  assistantText: string;
  userText?: string;
  signal?: AbortSignal;
  onChunk: (chunk: TtsChunk) => Promise<void> | void;
};

const TTS_API_KEY = (): string => (process.env.MIMO_API_KEY || "").trim();
const TTS_BASE_URL = (): string => (process.env.MIMO_TTS_BASE_URL || "https://api.xiaomimimo.com/v1").trim();
const TTS_MODEL = (): string => (process.env.MIMO_TTS_MODEL || "mimo-v2-tts").trim();
const TTS_VOICE = (): string => (process.env.MIMO_TTS_VOICE || "mimo_default").trim();
const TTS_FORMAT = (): string => (process.env.MIMO_TTS_FORMAT || "pcm16").trim().toLowerCase();
const TTS_FILTER_MODEL = (): string => (process.env.TTS_FILTER_MODEL || "qwen3.5-plus").trim();
const TTS_ENABLE_FINE_TAGS = (): boolean => (process.env.MIMO_TTS_ENABLE_FINE_TAGS || "1").trim() !== "0";
const TTS_SAMPLE_RATE = 24000;

const stripFence = (text: string): string => text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

const parseJsonObject = <T>(text: string): T | null => {
  const source = stripFence(text);
  try {
    return JSON.parse(source) as T;
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(source.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
};

const removeCodeAndLinks = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\|[^\n]+\|/g, " ")
    .replace(/[>#*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pickFallbackStyles = (text: string): string[] => {
  const styles: string[] = [];
  if (/(快一点|加快|快说|赶时间|赶紧|着急)/.test(text)) styles.push("变快");
  if (/(慢一点|放慢|慢说|别急|缓一点)/.test(text)) styles.push("变慢");
  if (/(开心|高兴|喜悦|太棒|哈哈|兴奋|庆祝|快乐)/.test(text)) styles.push("开心");
  if (/(难过|伤心|沮丧|失落|痛苦|哭|委屈)/.test(text)) styles.push("悲伤");
  if (/(愤怒|生气|恼火|烦死|气死|怒)/.test(text)) styles.push("生气");
  if (/(悄悄|小声|轻声|别吵|安静|耳语)/.test(text)) styles.push("悄悄话");
  return styles.length > 0 ? styles : ["平静"];
};

const sanitizeStyle = (styleRaw: string): string => styleRaw.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

const normalizeStyles = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeStyle(item))
    .filter((item) => item.length > 0)
    .slice(0, 4);
  return cleaned.length > 0 ? cleaned : fallback;
};

const prepareSpeechText = async (assistantText: string, userText?: string): Promise<PreparedSpeech> => {
  const fallbackSpeakText = removeCodeAndLinks(assistantText).slice(0, 1200);
  const fallbackStyles = pickFallbackStyles(fallbackSpeakText || assistantText);
  const fallbackStyle = fallbackStyles.join(" ");
  const fallback = {
    speakText: fallbackSpeakText,
    style: fallbackStyle,
    styledText: `<style>${fallbackStyle}</style>${fallbackSpeakText}`
  };

  if (!hasLlmConfig()) {
    return fallback;
  }

  try {
    const result = await llmChat(
      [
        {
          role: "system",
          content:
            "你是TTS播报文本整理器。请把输入内容转成可播报文本，删除代码块、链接、表格和不该念出来的内容。输出JSON，不要解释。字段：{\"speakText\":\"...\",\"styles\":[\"...\"],\"fineText\":\"...\"}。规则：1) speakText为纯可播报文本，中文自然口语，长度<=1200。2) styles为整体风格数组，可多项，示例：变快/变慢/开心/悲伤/生气/悄悄话/夹子音/台湾腔/东北话/四川话/河南话/粤语/孙悟空/林黛玉/唱歌。3) fineText是在speakText基础上加入细粒度音频标签与舞台提示，使用中文括号提示，如（深呼吸）（停顿）（咳嗽）（压低声音）（提高音量），可混合少量拟声词。4) 不要改动事实语义，不要加入代码。"
        },
        {
          role: "user",
          content: JSON.stringify({
            userText: (userText || "").slice(0, 300),
            assistantText: assistantText.slice(0, 5000)
          })
        }
      ],
      [],
      undefined,
      {
        model: TTS_FILTER_MODEL(),
        extraBody: { enable_thinking: false }
      }
    );

    const parsed = parseJsonObject<{ speakText?: unknown; styles?: unknown; fineText?: unknown }>(result);
    const speakTextRaw = typeof parsed?.speakText === "string" ? parsed.speakText : fallbackSpeakText;
    const speakText = removeCodeAndLinks(speakTextRaw).slice(0, 1200).trim();
    const styles = normalizeStyles(parsed?.styles, fallbackStyles);
    const style = styles.join(" ");
    const fineTextRaw = typeof parsed?.fineText === "string" ? parsed.fineText : "";
    const fineText = fineTextRaw
      .replace(/<style>[\s\S]*?<\/style>/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1400);
    const bodyText = TTS_ENABLE_FINE_TAGS() && fineText ? fineText : speakText;

    if (!speakText) return fallback;
    return {
      speakText,
      style,
      styledText: `<style>${style}</style>${bodyText}`
    };
  } catch {
    return fallback;
  }
};

export const hasTtsConfig = (): boolean => TTS_API_KEY().length > 0;

export const streamTtsAudio = async (
  options: StreamTtsOptions
): Promise<{ emittedChunks: number; style: string; sampleRate: number }> => {
  if (!hasTtsConfig()) {
    return { emittedChunks: 0, style: "", sampleRate: TTS_SAMPLE_RATE };
  }

  const prepared = await prepareSpeechText(options.assistantText, options.userText);
  if (!prepared.speakText) {
    return { emittedChunks: 0, style: prepared.style, sampleRate: TTS_SAMPLE_RATE };
  }

  const client = new OpenAI({
    apiKey: TTS_API_KEY(),
    baseURL: TTS_BASE_URL()
  });

  const stream = (await client.chat.completions.create(
    {
      model: TTS_MODEL(),
      messages: [
        ...(options.userText
          ? [
              {
                role: "user" as const,
                content: options.userText.slice(0, 600)
              }
            ]
          : []),
        {
          role: "assistant" as const,
          content: prepared.styledText
        }
      ],
      audio: {
        format: TTS_FORMAT(),
        voice: TTS_VOICE()
      },
      stream: true
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options.signal ? { signal: options.signal } : undefined
  )) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

  let seq = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
      audio?: { data?: string };
    };
    const data = delta?.audio?.data;
    if (!data) continue;
    await options.onChunk({ data, seq });
    seq += 1;
  }

  return {
    emittedChunks: seq,
    style: prepared.style,
    sampleRate: TTS_SAMPLE_RATE
  };
};
