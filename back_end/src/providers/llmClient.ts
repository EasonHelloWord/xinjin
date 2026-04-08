import OpenAI from "openai";

const resolveLlmApiKey = (): string => (process.env.LLM_API_KEY || "").trim();
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim();
const LLM_MODEL = (process.env.LLM_MODEL || "gpt-4o-mini").trim();
const MCP_DEBUG = process.env.MCP_DEBUG === "1";

export const hasLlmConfig = (): boolean =>
  resolveLlmApiKey().length > 0;

export const createLlmClient = (): OpenAI => {
  if (!hasLlmConfig()) throw new Error("LLM_API_KEY is missing");
  return new OpenAI({ baseURL: LLM_BASE_URL, apiKey: resolveLlmApiKey() });
};

export type LlmMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export const llmChat = async (
  messages: LlmMessage[],
  tools: OpenAI.Chat.ChatCompletionTool[] = [],
  toolExecutor?: ToolExecutor
): Promise<string> => {
  const client = createLlmClient();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = messages as OpenAI.Chat.ChatCompletionMessageParam[];

  for (let i = 0; i < 8; i++) {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: LLM_MODEL,
      messages: msgs,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {})
    };

    const completion = await client.chat.completions.create(params);
    const choice = completion.choices[0];
    if (!choice) break;

    const msg = choice.message;
    msgs.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length) {
      return msg.content?.trim() || "";
    }

    if (!toolExecutor) break;

    for (const tc of msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) {
      if (MCP_DEBUG) {
        console.info(`[xinjin-llm] tool_call ${tc.function.name} ${tc.function.arguments || "{}"}`);
      }
      let result: string;
      try {
        const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        result = await toolExecutor(tc.function.name, args);
      } catch (e) {
        result = `Error: ${String(e)}`;
      }
      if (MCP_DEBUG) {
        console.info(`[xinjin-llm] tool_result ${tc.function.name} ${result.slice(0, 400)}`);
      }
      msgs.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return "";
};
