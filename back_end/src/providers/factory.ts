import { hasLlmConfig } from "./llmClient";
import { LlmEmotionAnalyzer, LlmPlanGenerator } from "./llmProvider";
import { MockEmotionAnalyzer, MockPlanGenerator } from "./mockProvider";
import { EmotionAnalyzer, PlanGenerator } from "./types";

type ProviderBundle = {
  emotionAnalyzer: EmotionAnalyzer;
  planGenerator: PlanGenerator;
  providerName: string;
};

export const getProviders = (): ProviderBundle => {
  if (hasLlmConfig()) {
    return {
      emotionAnalyzer: new LlmEmotionAnalyzer(),
      planGenerator: new LlmPlanGenerator(),
      providerName: "llm"
    };
  }

  return {
    emotionAnalyzer: new MockEmotionAnalyzer(),
    planGenerator: new MockPlanGenerator(),
    providerName: "mock"
  };
};
