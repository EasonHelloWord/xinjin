import { hasDeepSeekConfig } from "./deepseekClient";
import { DeepSeekEmotionAnalyzer, DeepSeekPlanGenerator } from "./deepseekProvider";
import { MockEmotionAnalyzer, MockPlanGenerator } from "./mockProvider";
import { EmotionAnalyzer, PlanGenerator } from "./types";

type ProviderBundle = {
  emotionAnalyzer: EmotionAnalyzer;
  planGenerator: PlanGenerator;
  providerName: string;
};

export const getProviders = (): ProviderBundle => {
  const preferred = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const canUseDeepSeek = hasDeepSeekConfig();
  const useDeepSeek = preferred === "deepseek" || (!preferred && canUseDeepSeek);

  if (useDeepSeek && canUseDeepSeek) {
    return {
      emotionAnalyzer: new DeepSeekEmotionAnalyzer(),
      planGenerator: new DeepSeekPlanGenerator(),
      providerName: "deepseek"
    };
  }

  return {
    emotionAnalyzer: new MockEmotionAnalyzer(),
    planGenerator: new MockPlanGenerator(),
    providerName: "mock"
  };
};
