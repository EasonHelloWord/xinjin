import { MockEmotionAnalyzer, MockPlanGenerator } from "./mockProvider";
import { llmChat } from "./llmClient";
import { listMcpTools, callMcpTool } from "../mcp/mcpClient";
import { AnalyzeInput, AnalyzeOutput, EmotionAnalyzer, PlanGenerator, PlanInput, PlanOutput } from "./types";

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

const clampConfidence = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

export class LlmEmotionAnalyzer implements EmotionAnalyzer {
  private readonly fallback = new MockEmotionAnalyzer();

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    try {
      const tools = await listMcpTools();
      const content = await llmChat(
        [
          {
            role: "system",
            content:
              "你是心理状态结构化分析器。遵循安全优先：对强烈负面情绪、风险表达、短时情绪反转保持敏感，不要轻率归为正常。请只输出 JSON，不要解释。字段：emotionTags(string[]), contradictions(string[]), summary(string), stateType(必须是 sensory_overload|emotional_block|mixed_fluctuation|stable_normal), stateConfidence(number,0-1)。stateType 含义：sensory_overload=感官过载，emotional_block=情感屏蔽，mixed_fluctuation=波动混合，stable_normal=整体基本稳定、可正常运转，虽可能有轻微波动但未达到明显失衡。存在明显高风险、持续痛苦或剧烈失衡时，不要误判为 stable_normal。emotionTags 需要基于当前输入实时生成 2-5 个面向用户可读的简短中文标签，必须全部使用自然中文，不要输出英文、拼音、下划线命名、技术代号或中英混写；例如应写“有些焦虑”“有点疲惫”“自我调节中”“愿意求助”，不要写 anxiety、fatigue、self_adjusting。标签不应只包含负面症状，也可以包含中性状态、调节倾向、轻度正向资源信号。例如当文本里出现平静、想调整、愿意求助、仍有期待、能够自我观察、暂时稳定、需要空间等信号时，应加入对应的中性或轻度正向标签。只有在文本确实几乎全是痛苦/风险信号时，才允许标签几乎全为负向。"
          },
          { role: "user", content: JSON.stringify(input) }
        ],
        tools,
        callMcpTool,
        { extraBody: { enable_thinking: false } }
      );

      const parsed = parseJsonObject<Partial<AnalyzeOutput>>(content);
      if (!parsed) return this.fallback.analyze(input);

      const stateType =
        parsed.stateType === "sensory_overload" ||
        parsed.stateType === "emotional_block" ||
        parsed.stateType === "mixed_fluctuation" ||
        parsed.stateType === "stable_normal"
          ? parsed.stateType
          : undefined;

      if (!stateType || typeof parsed.summary !== "string") {
        return this.fallback.analyze(input);
      }

      return {
        emotionTags: Array.isArray(parsed.emotionTags) ? parsed.emotionTags.filter((x): x is string => typeof x === "string") : [],
        contradictions: Array.isArray(parsed.contradictions)
          ? parsed.contradictions.filter((x): x is string => typeof x === "string")
          : [],
        summary: parsed.summary,
        stateType,
        stateConfidence: clampConfidence((parsed as { stateConfidence?: unknown }).stateConfidence, 0.65)
      };
    } catch {
      return this.fallback.analyze(input);
    }
  }
}

export class LlmPlanGenerator implements PlanGenerator {
  private readonly fallback = new MockPlanGenerator();

  async generate(input: PlanInput): Promise<PlanOutput> {
    try {
      const tools = await listMcpTools();
      const content = await llmChat(
        [
          {
            role: "system",
            content:
              "你是心理调理建议生成器，使用多元化六维调整模式。遵循心理安全优先：当存在明显高风险或剧烈波动时，先给安全与转介建议，再给日常建议。每个维度建议写成1-2句、60字左右，语气温和有行动感，可加入1个贴切emoji。建议必须是可执行动作句，禁止解释原因、禁止展示推理过程。请只输出 JSON。字段：sixDimAdvice(object，含 body/emotion/cognition/behavior/relation/environment 六个 string 字段), microTasks(string[]), riskNotice(string,可空), tcmConfidence(number,0-1), westernConfidence(number,0-1)。"
          },
          { role: "user", content: JSON.stringify(input) }
        ],
        tools,
        callMcpTool,
        { extraBody: { enable_thinking: false } }
      );

      const parsed = parseJsonObject<Partial<PlanOutput>>(content);
      if (!parsed) return this.fallback.generate(input);

      const sixDimRaw = parsed.sixDimAdvice as Partial<PlanOutput["sixDimAdvice"]> | undefined;
      const sixDimAdvice = sixDimRaw
        ? {
            body: typeof sixDimRaw.body === "string" ? sixDimRaw.body : "",
            emotion: typeof sixDimRaw.emotion === "string" ? sixDimRaw.emotion : "",
            cognition: typeof sixDimRaw.cognition === "string" ? sixDimRaw.cognition : "",
            behavior: typeof sixDimRaw.behavior === "string" ? sixDimRaw.behavior : "",
            relation: typeof sixDimRaw.relation === "string" ? sixDimRaw.relation : "",
            environment: typeof sixDimRaw.environment === "string" ? sixDimRaw.environment : ""
          }
        : null;
      const microTasks = Array.isArray(parsed.microTasks)
        ? parsed.microTasks.filter((x): x is string => typeof x === "string")
        : [];

      if (
        !sixDimAdvice ||
        !sixDimAdvice.body ||
        !sixDimAdvice.emotion ||
        !sixDimAdvice.cognition ||
        !sixDimAdvice.behavior ||
        !sixDimAdvice.relation ||
        !sixDimAdvice.environment ||
        microTasks.length === 0
      ) {
        return this.fallback.generate(input);
      }

      return {
        sixDimAdvice,
        microTasks,
        riskNotice: typeof parsed.riskNotice === "string" ? parsed.riskNotice : undefined,
        tcmConfidence: clampConfidence((parsed as { tcmConfidence?: unknown }).tcmConfidence, 0.68),
        westernConfidence: clampConfidence((parsed as { westernConfidence?: unknown }).westernConfidence, 0.68)
      };
    } catch {
      return this.fallback.generate(input);
    }
  }
}
