import { AnalyzeInput, AnalyzeOutput, EmotionAnalyzer, PlanGenerator, PlanInput, PlanOutput } from "./types";

const pickStateType = (input: AnalyzeInput): AnalyzeOutput["stateType"] => {
  const text = input.text.toLowerCase();
  const hasOverloadWord =
    text.includes("乱") ||
    text.includes("吵") ||
    text.includes("焦虑") ||
    text.includes("overwhelm") ||
    text.includes("anx");
  const hasBlockWord =
    text.includes("麻木") ||
    text.includes("空") ||
    text.includes("不想") ||
    text.includes("冷") ||
    text.includes("numb");
  const hasMixSignal =
    (typeof input.sleepHours === "number" && input.sleepHours >= 7.5 && (input.fatigueLevel ?? 3) >= 4) ||
    ((input.socialWillingness ?? 3) <= 2 && (input.fatigueLevel ?? 3) >= 4);

  if (hasMixSignal || (hasOverloadWord && hasBlockWord)) return "mixed_fluctuation";
  if (hasOverloadWord) return "sensory_overload";
  if (hasBlockWord) return "emotional_block";
  return input.level === "moderate" || input.level === "severe" ? "mixed_fluctuation" : "sensory_overload";
};

const buildEmotionTags = (input: AnalyzeInput): string[] => {
  const tags = new Set<string>();
  const text = input.text.toLowerCase();

  if (text.includes("焦虑") || text.includes("慌") || text.includes("紧张")) tags.add("anxiety");
  if (text.includes("累") || text.includes("疲")) tags.add("fatigue");
  if (text.includes("空") || text.includes("麻木")) tags.add("numbness");
  if (text.includes("烦") || text.includes("生气")) tags.add("irritability");

  if (tags.size === 0) tags.add("low_stability");
  return Array.from(tags);
};

const buildContradictions = (input: AnalyzeInput): string[] => {
  const contradictions: string[] = [];
  if (typeof input.sleepHours === "number" && input.sleepHours >= 7.5 && (input.fatigueLevel ?? 3) >= 4) {
    contradictions.push("sleep_enough_but_still_tired");
  }
  if ((input.socialWillingness ?? 3) <= 2 && input.text.includes("想被理解")) {
    contradictions.push("want_connection_but_avoid_social");
  }
  if (contradictions.length === 0) contradictions.push("none_explicit");
  return contradictions;
};

export class MockEmotionAnalyzer implements EmotionAnalyzer {
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const stateType = pickStateType(input);
    const emotionTags = buildEmotionTags(input);
    const contradictions = buildContradictions(input);

    const stateText =
      stateType === "sensory_overload"
        ? "更接近感官过载"
        : stateType === "emotional_block"
          ? "更接近情感屏蔽"
          : "更接近波动混合";

    return {
      emotionTags,
      contradictions,
      stateType,
      summary: `你当前${stateText}状态，情绪与能量信号存在短时失衡，建议先降负荷再做小步调节。`
    };
  }
}

const levelRiskNotice = (level: PlanInput["level"]): string | undefined => {
  if (level === "moderate") return "建议尽快和校心理中心或可信任老师沟通，获取专业支持。";
  if (level === "severe") return "当前风险较高，建议尽快寻求专业医疗或心理危机干预支持。";
  return undefined;
};

const stateSpecificTcm = (stateType: PlanInput["stateType"]): string[] => {
  if (stateType === "sensory_overload") {
    return ["轻拍肘窝 3-5 分钟，配合缓慢呼气", "菊花枸杞茶或淡麦冬茶，减少咖啡因"];
  }
  if (stateType === "emotional_block") {
    return ["温热足浴 10 分钟，结束后按揉内关穴与神门穴", "清淡温补饮食，避免过甜过辣刺激"];
  }
  return ["先做腹式呼吸，再进行颈肩轻拉伸 5 分钟", "白天补充温水，晚间减少高油高糖饮食"];
};

const stateSpecificWestern = (stateType: PlanInput["stateType"]): string[] => {
  if (stateType === "sensory_overload") {
    return ["执行 5 分钟呼吸节律训练（吸 4 秒、呼 6 秒）", "列出一件当下可完成的小任务并限时 20 分钟"];
  }
  if (stateType === "emotional_block") {
    return ["做一次 3 分钟身体扫描，把注意力放回当下感受", "发一条低压力社交消息给可信任对象"];
  }
  return ["先完成 1 件低成本任务建立确定感", "记录当前触发因素与想法，做一次认知重评估"];
};

export class MockPlanGenerator implements PlanGenerator {
  async generate(input: PlanInput): Promise<PlanOutput> {
    const tcmAdvice = stateSpecificTcm(input.stateType);
    const westernAdvice = stateSpecificWestern(input.stateType);
    const microTasks = ["现在开始 3 分钟呼吸或拉伸", "今天只完成 1 个最小行动并记录感受", "睡前写下明日第一步任务"];
    const riskNotice = levelRiskNotice(input.level);

    if (input.level === "mild") {
      return {
        tcmAdvice,
        westernAdvice: westernAdvice.slice(0, 1),
        microTasks,
        riskNotice
      };
    }

    if (input.level === "severe") {
      return {
        tcmAdvice: tcmAdvice.slice(0, 1),
        westernAdvice,
        microTasks,
        riskNotice
      };
    }

    return {
      tcmAdvice,
      westernAdvice,
      microTasks,
      riskNotice
    };
  }
}
