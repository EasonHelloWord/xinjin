import { MockEmotionAnalyzer, MockPlanGenerator } from "./mockProvider";
import { deepSeekChat } from "./deepseekClient";
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

export class DeepSeekEmotionAnalyzer implements EmotionAnalyzer {
  private readonly fallback = new MockEmotionAnalyzer();

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    try {
      const content = await deepSeekChat([
        {
          role: "system",
          content:
            "你是心理状态结构化分析器。遵循安全优先：对强烈负面情绪、风险表达、短时情绪反转保持敏感，不要轻率归为正常。请只输出 JSON，不要解释。字段：emotionTags(string[]), contradictions(string[]), summary(string), stateType(必须是 sensory_overload|emotional_block|mixed_fluctuation), stateConfidence(number,0-1)"
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ]);

      const parsed = parseJsonObject<Partial<AnalyzeOutput>>(content);
      if (!parsed) {
        return this.fallback.analyze(input);
      }

      const stateType =
        parsed.stateType === "sensory_overload" ||
        parsed.stateType === "emotional_block" ||
        parsed.stateType === "mixed_fluctuation"
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

export class DeepSeekPlanGenerator implements PlanGenerator {
  private readonly fallback = new MockPlanGenerator();

  async generate(input: PlanInput): Promise<PlanOutput> {
    try {
      const content = await deepSeekChat([
        {
          role: "system",
          content:
            "你是心理调理建议生成器，使用多元化六维调整模式。遵循心理安全优先：当存在明显高风险或剧烈波动时，先给安全与转介建议，再给日常建议。建议必须是可执行动作句，禁止解释原因、禁止展示推理过程。请只输出 JSON。字段：sixDimAdvice(object，含 body/emotion/cognition/behavior/relation/environment 六个 string 字段), microTasks(string[]), riskNotice(string,可空), tcmConfidence(number,0-1), westernConfidence(number,0-1)。"
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ]);

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
