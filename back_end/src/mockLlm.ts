export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export const toStreamTokens = (text: string): string[] => Array.from(text);

const normalizeUserText = (text: string): string => text.trim().replace(/\s+/g, " ");

export const generateMockAssistantReply = (history: ChatHistoryItem[]): string => {
  const lastUser = [...history].reverse().find((item) => item.role === "user");
  const userText = normalizeUserText(lastUser?.content ?? "\u4f60\u8fd8\u6ca1\u6709\u8f93\u5165\u5177\u4f53\u95ee\u9898\u3002");

  const suggest1 = "\u5148\u628a\u76ee\u6807\u7f29\u5c0f\u5230\u4eca\u5929\u80fd\u5b8c\u6210\u7684\u4e00\u6b65\uff0c\u5e76\u5199\u6210\u53ef\u6267\u884c\u52a8\u4f5c\u3002";
  const suggest2 = "\u7ed9\u8fd9\u4e00\u6b65\u8bbe\u7f6e 20 \u5206\u949f\u65f6\u95f4\u76d2\uff0c\u5148\u5b8c\u6210\u518d\u4f18\u5316\u3002";
  const suggest3 = "\u7ed3\u675f\u540e\u8bb0\u5f55\u4e00\u4e2a\u963b\u788d\u70b9\uff0c\u4e0b\u4e00\u8f6e\u53ea\u6539\u8fd9\u4e00\u70b9\u3002";

  return [
    `\u6211\u7406\u89e3\u4f60\u7684\u91cd\u70b9\u662f\uff1a${userText}\u3002`,
    `\u5efa\u8bae\u4e00\uff1a${suggest1}`,
    `\u5efa\u8bae\u4e8c\uff1a${suggest2}`,
    `\u5efa\u8bae\u4e09\uff1a${suggest3}`,
    "\u5982\u679c\u4f60\u613f\u610f\uff0c\u6211\u53ef\u4ee5\u7ee7\u7eed\u5e2e\u4f60\u628a\u4e0b\u4e00\u6b65\u62c6\u5f97\u66f4\u5177\u4f53\u3002"
  ].join("\n");
};