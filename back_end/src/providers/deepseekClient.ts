import OpenAI from "openai";

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export const hasDeepSeekConfig = (): boolean =>
  Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim().length > 0);

export const createDeepSeekClient = (): OpenAI => {
  if (!hasDeepSeekConfig()) {
    throw new Error("DEEPSEEK_API_KEY is missing");
  }
  return new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY
  });
};

export const deepSeekChat = async (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string> => {
  const client = createDeepSeekClient();
  const completion = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages
  });
  return completion.choices[0]?.message?.content?.trim() || "";
};
