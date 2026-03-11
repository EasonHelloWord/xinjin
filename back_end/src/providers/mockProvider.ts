import { AnalyzeInput, AnalyzeOutput, EmotionAnalyzer, PlanGenerator, PlanInput, PlanOutput, SixDimAdvice } from "./types";

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

const confidenceByLevel = (level: AnalyzeInput["level"]): number => {
  if (level === "healthy") return 0.78;
  if (level === "mild") return 0.72;
  if (level === "moderate") return 0.66;
  return 0.61;
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
      summary: `你当前${stateText}状态，情绪与能量信号存在短时失衡，建议先降负荷再做小步调节。`,
      stateConfidence: confidenceByLevel(input.level)
    };
  }
}

const levelRiskNotice = (level: PlanInput["level"]): string | undefined => {
  if (level === "moderate") return "建议尽快和校心理中心或可信任老师沟通，获取专业支持。";
  if (level === "severe") return "当前风险较高，建议尽快寻求专业医疗或心理危机干预支持。";
  return undefined;
};

const buildSixDimAdvice = (input: PlanInput): SixDimAdvice => {
  if (input.level === "severe") {
    return {
      body: "深呼吸3次：吸气4秒，屏住2秒，呼气6秒。每一次呼气，想象把胸口闷的感觉轻轻呼出去一点点。",
      emotion: "给此刻情绪起个名字，比如“胸口这团叫石头”。轻轻对它说：“我知道你在，我先不处理你，只是看着你。”",
      cognition: "写下脑子里出现的一个念头，然后画一条线，对自己说：“这是一个想法，不是事实。”",
      behavior: "今天只做一件事：喝一杯温水。完成这件事，就够了。",
      relation: "给一位信任的人发一条消息，哪怕只是“在吗”。如果发不出，就想一个让你感到安全的人。",
      environment: "拉开窗帘，让自然光照进来。看五分钟窗外的世界，提醒自己世界还在运转。"
    };
  }

  if (input.level === "moderate" || input.stateType === "emotional_block") {
    return {
      body: "找个有阳光的地方，背对太阳坐10-15分钟，感受后背慢慢晒暖。",
      emotion: "摸一摸身边某样东西，认真感受它的质感，用触觉轻轻唤醒感官。",
      cognition: "写下今天看见的三件小事，不求意义，只保持和当下的连接。",
      behavior: "今天只做一件微小的事：下楼慢走5分钟，感受脚底与地面的接触。",
      relation: "给一位信任的人发一条简短消息，重点是“发出去了”，不强求回复。",
      environment: "书桌旁放一杯温水，提醒自己可以像这杯水一样安静地待着。"
    };
  }

  return {
    body: "用4-7-8呼吸法降速：吸4秒、屏7秒、呼8秒，重复3-5次。",
    emotion: "给脑子里的乱麻起个名字，然后对它说：“我知道了，你先待着。”",
    cognition: "当脑子转不停时，对自己说：“停，现在不需要想清楚。”",
    behavior: "关闭手机通知1-2小时，给自己一段“信息节食”时间。",
    relation: "今天可以不回复任何消息，告诉身边的人你需要一点独处时间。",
    environment: "整理书桌，只留下三样东西：一杯水、一盆绿植、一本纸质书。"
  };
};

export class MockPlanGenerator implements PlanGenerator {
  async generate(input: PlanInput): Promise<PlanOutput> {
    const sixDimAdvice = buildSixDimAdvice(input);
    const riskNotice =
      input.level === "severe"
        ? "请尽快联系校心理咨询中心（21号楼101，电话021-50211131）或拨打上海市心理救援热线021-962525（24小时）。"
        : levelRiskNotice(input.level);

    if (input.level === "severe") {
      return {
        sixDimAdvice,
        microTasks: ["深呼吸3次，吸气时想象把稳定吸进来", "拉开窗帘，看窗外一分钟", "今晚泡一杯温水，双手捧着喝下"],
        riskNotice,
        tcmConfidence: 0.64,
        westernConfidence: 0.68
      };
    }

    if (input.level === "moderate") {
      return {
        sixDimAdvice,
        microTasks: ["喝一杯温水，感受温度从喉咙暖到胃里", "站起来轻轻踮脚尖，重复20次", "今晚早睡30分钟，拉严窗帘"],
        riskNotice,
        tcmConfidence: 0.7,
        westernConfidence: 0.7
      };
    }

    return {
      sixDimAdvice,
      microTasks: ["泡一杯茶，看着茶叶慢慢舒展", "闭眼30秒，听听周围有几种声音", "今晚早睡30分钟，睡前不碰手机"],
      riskNotice,
      tcmConfidence: 0.74,
      westernConfidence: 0.72
    };
  }
}
