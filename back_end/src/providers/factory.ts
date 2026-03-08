import { MockEmotionAnalyzer, MockPlanGenerator } from "./mockProvider";
import { EmotionAnalyzer, PlanGenerator } from "./types";

type ProviderBundle = {
  emotionAnalyzer: EmotionAnalyzer;
  planGenerator: PlanGenerator;
  providerName: string;
};

export const getProviders = (): ProviderBundle => {
  const providerName = process.env.AI_PROVIDER || "mock";

  // Real providers are intentionally reserved for next phase.
  return {
    emotionAnalyzer: new MockEmotionAnalyzer(),
    planGenerator: new MockPlanGenerator(),
    providerName
  };
};
