import { clampState, State } from "./protocol";

export interface MockBrainResult {
  replyText: string;
  suggestedPreset: string;
  statePatch: Partial<State>;
}

type Rule = {
  preset: string;
  keywords: string[];
  deltas: Partial<Record<keyof State, number>>;
  replyText: string;
};

const RULES: Rule[] = [
  {
    preset: "anxious",
    keywords: ["焦虑", "慌", "紧张", "心跳", "压迫"],
    deltas: {
      arousal: 0.2,
      stability: -0.2,
      valence: -0.1
    },
    replyText:
      "我捕捉到紧张和焦虑信号。我们先做30秒呼吸收束，再把任务拆成最小一步。"
  },
  {
    preset: "angry",
    keywords: ["生气", "烦", "怒", "崩溃"],
    deltas: {
      arousal: 0.15,
      valence: -0.25,
      intensity: 0.1
    },
    replyText:
      "我感受到明显的烦躁和冲击。先暂停60秒，把最想处理的一件事单独列出来。"
  },
  {
    preset: "tired",
    keywords: ["累", "困", "没劲", "熬夜"],
    deltas: {
      load: 0.2,
      intensity: -0.15,
      stability: -0.05
    },
    replyText:
      "像是能量偏低、负荷偏高。先做5分钟低成本恢复：喝水加站立伸展，再决定是否继续。"
  },
  {
    preset: "calm",
    keywords: ["开心", "轻松", "舒服"],
    deltas: {
      valence: 0.2,
      arousal: -0.1,
      stability: 0.1
    },
    replyText: "我捕捉到比较积极和平稳的状态。可以延续这个节奏，优先做一件有确定反馈的小任务。"
  }
];

const DEFAULT_RESULT: MockBrainResult = {
  suggestedPreset: "neutral",
  replyText: "我已收到你的输入。先标记当前感受，再从最小可执行的一步开始。",
  statePatch: {}
};

export const mockBrain = (text: string, baseState: State): MockBrainResult => {
  const normalized = text.toLowerCase();
  const rule = RULES.find((candidate) =>
    candidate.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );

  if (!rule) {
    return DEFAULT_RESULT;
  }

  const nextPatch: Partial<State> = {};
  for (const [key, delta] of Object.entries(rule.deltas) as Array<[keyof State, number]>) {
    nextPatch[key] = (baseState[key] ?? 0.5) + delta;
  }

  return {
    suggestedPreset: rule.preset,
    replyText: rule.replyText,
    statePatch: clampState(nextPatch)
  };
};
