import OpenAI from "openai";

const resolveLlmApiKey = (): string => (process.env.LLM_API_KEY || "").trim();
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim();
const LLM_MODEL = (process.env.LLM_MODEL || "gpt-4o-mini").trim();
const MCP_DEBUG = process.env.MCP_DEBUG === "1";

export const hasLlmConfig = (): boolean =>
  resolveLlmApiKey().length > 0;

export const getLlmRuntimeInfo = (modelOverride?: string): { baseUrl: string; model: string; hasConfig: boolean } => ({
  baseUrl: LLM_BASE_URL,
  model: (modelOverride || "").trim() || LLM_MODEL,
  hasConfig: hasLlmConfig()
});

export const createLlmClient = (): OpenAI => {
  if (!hasLlmConfig()) throw new Error("LLM_API_KEY is missing");
  return new OpenAI({ baseURL: LLM_BASE_URL, apiKey: resolveLlmApiKey() });
};

export type LlmMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;
export type TextDeltaHandler = (text: string) => Promise<void> | void;
type LlmChatOptions = {
  signal?: AbortSignal;
  onTextDelta?: TextDeltaHandler;
  model?: string;
  extraBody?: Record<string, unknown>;
};
type StreamToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

const createRequestOptions = (signal?: AbortSignal): { signal: AbortSignal } | undefined =>
  signal ? { signal } : undefined;

const accumulateToolCalls = (toolCalls: StreamToolCall[], deltas: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>): void => {
  for (const delta of deltas) {
    const existing = toolCalls[delta.index] ?? {
      id: "",
      type: "function" as const,
      function: {
        name: "",
        arguments: ""
      }
    };
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.function.name += delta.function.name;
    if (delta.function?.arguments) existing.function.arguments += delta.function.arguments;
    toolCalls[delta.index] = existing;
  }
};

const streamChatCompletion = async (
  client: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  onTextDelta?: TextDeltaHandler,
  signal?: AbortSignal
): Promise<{
  content: string;
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"];
  toolCalls: StreamToolCall[];
}> => {
  const stream = (await client.chat.completions.create(
    params,
    createRequestOptions(signal)
  )) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  let content = "";
  let finishReason: OpenAI.Chat.ChatCompletionChunk.Choice["finish_reason"] = null;
  const toolCalls: StreamToolCall[] = [];

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      await onTextDelta?.(delta.content);
    }
    if (delta.tool_calls?.length) {
      accumulateToolCalls(
        toolCalls,
        delta.tool_calls.map((item) => ({
          index: item.index,
          id: item.id,
          function: {
            name: item.function?.name,
            arguments: item.function?.arguments
          }
        }))
      );
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }
  return {
    content,
    finishReason,
    toolCalls: toolCalls.filter(
      (item): item is StreamToolCall => Boolean(item && item.id && item.function.name)
    )
  };
};

export const llmChat = async (
  messages: LlmMessage[],
  tools: OpenAI.Chat.ChatCompletionTool[] = [],
  toolExecutor?: ToolExecutor,
  options: LlmChatOptions = {}
): Promise<string> => {
  const client = createLlmClient();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = messages as OpenAI.Chat.ChatCompletionMessageParam[];

  for (let i = 0; i < 8; i++) {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: (options.model || "").trim() || LLM_MODEL,
      messages: msgs,
      ...(options.extraBody ?? {}),
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {})
    };

    const completion = await client.chat.completions.create(params, createRequestOptions(options.signal));
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

export const llmChatStream = async (
  messages: LlmMessage[],
  tools: OpenAI.Chat.ChatCompletionTool[] = [],
  toolExecutor?: ToolExecutor,
  options: LlmChatOptions = {}
): Promise<string> => {
  const client = createLlmClient();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = messages as OpenAI.Chat.ChatCompletionMessageParam[];

  for (let i = 0; i < 8; i++) {
    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: (options.model || "").trim() || LLM_MODEL,
      messages: msgs,
      stream: true,
      ...(options.extraBody ?? {}),
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {})
    };

    const turn = await streamChatCompletion(client, params, options.onTextDelta, options.signal);
    msgs.push({
      role: "assistant",
      content: turn.content || null,
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {})
    } as OpenAI.Chat.ChatCompletionMessageParam);

    if (turn.finishReason !== "tool_calls" || turn.toolCalls.length === 0) {
      return turn.content.trim();
    }

    if (!toolExecutor) break;

    for (const tc of turn.toolCalls) {
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
