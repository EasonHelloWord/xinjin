import { hasLlmConfig, llmChat, llmChatStream, TextDeltaHandler } from "./providers/llmClient";
import { listMcpTools, callMcpTool } from "./mcp/mcpClient";

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export const toStreamTokens = (text: string): string[] => Array.from(text);
type GenerateAssistantReplyOptions = {
  signal?: AbortSignal;
  onTextDelta?: TextDeltaHandler;
};

const normalizeUserText = (text: string): string => text.trim().replace(/\s+/g, " ");

export const generateMockAssistantReply = (history: ChatHistoryItem[]): string => {
  const lastUser = [...history].reverse().find((item) => item.role === "user");
  const userText = normalizeUserText(lastUser?.content ?? "你还没有输入具体问题。");
  return [
    `我理解你的重点是：${userText}。`,
    "建议一：先把目标缩小到今天能完成的一步，并写成可执行动作。",
    "建议二：给这一步设置 20 分钟时间盒，先完成再优化。",
    "建议三：结束后记录一个阻碍点，下一轮只改这一点。",
    "如果你愿意，我可以继续帮你把下一步拆得更具体。"
  ].join("\n");
};

export const generateAssistantReply = async (
  history: ChatHistoryItem[],
  options: GenerateAssistantReplyOptions = {}
): Promise<string> => {
  let emittedAnyToken = false;
  const onTextDelta = options.onTextDelta
    ? async (text: string): Promise<void> => {
        emittedAnyToken = true;
        await options.onTextDelta?.(text);
      }
    : undefined;

  if (!hasLlmConfig()) {
    const reply = generateMockAssistantReply(history);
    if (onTextDelta) {
      for (const token of toStreamTokens(reply)) {
        await onTextDelta(token);
      }
    }
    return reply;
  }

  try {
    const tools = await listMcpTools();
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: "你是心镜项目中的支持型助手。请用简洁、温和、可执行的方式回答，输出 2-4 句话，优先给下一步动作。"
      }
    ];
    for (const item of history) {
      messages.push({ role: item.role, content: item.content });
    }
    const reply = onTextDelta
      ? await llmChatStream(messages, tools, callMcpTool, { ...options, onTextDelta })
      : await llmChat(messages, tools, callMcpTool, options);
    if (reply.trim()) return reply.trim();
    return generateMockAssistantReply(history);
  } catch {
    const reply = generateMockAssistantReply(history);
    if (onTextDelta && !emittedAnyToken) {
      for (const token of toStreamTokens(reply)) {
        await onTextDelta(token);
      }
    }
    return reply;
  }
};
