export type UserLevel = "healthy" | "mild" | "moderate" | "severe";

export type StateType = "sensory_overload" | "emotional_block" | "mixed_fluctuation";

export interface AnalyzeInput {
  text: string;
  level: UserLevel;
  sleepHours?: number;
  fatigueLevel?: number;
  socialWillingness?: number;
}

export interface AnalyzeOutput {
  emotionTags: string[];
  contradictions: string[];
  summary: string;
  stateType: StateType;
}

export interface PlanInput {
  level: UserLevel;
  stateType: StateType;
  summary: string;
}

export interface PlanOutput {
  tcmAdvice: string[];
  westernAdvice: string[];
  microTasks: string[];
  riskNotice?: string;
}

export interface EmotionAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

export interface PlanGenerator {
  generate(input: PlanInput): Promise<PlanOutput>;
}
