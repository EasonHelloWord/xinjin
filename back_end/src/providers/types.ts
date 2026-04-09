export type UserLevel = "healthy" | "mild" | "moderate" | "severe";

export type StateType = "sensory_overload" | "emotional_block" | "mixed_fluctuation" | "stable_normal";

export type AssessmentSectionScores = {
  emotion: number;
  selfAndRelation: number;
  bodyAndVitality: number;
  meaningAndHope: number;
};

export type AdviceConfidence = {
  state: number;
  tcm: number;
  western: number;
};

export interface SixDimAdvice {
  body: string;
  emotion: string;
  cognition: string;
  behavior: string;
  relation: string;
  environment: string;
}

export interface AnalyzeInput {
  text: string;
  level: UserLevel;
  sleepHours?: number;
  fatigueLevel?: number;
  socialWillingness?: number;
  assessmentScore?: number;
  assessmentSectionScores?: AssessmentSectionScores;
}

export interface AnalyzeOutput {
  emotionTags: string[];
  contradictions: string[];
  summary: string;
  stateType: StateType;
  stateConfidence?: number;
}

export interface PlanInput {
  level: UserLevel;
  stateType: StateType;
  summary: string;
}

export interface PlanOutput {
  sixDimAdvice: SixDimAdvice;
  microTasks: string[];
  riskNotice?: string;
  tcmConfidence?: number;
  westernConfidence?: number;
}

export interface EmotionAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

export interface PlanGenerator {
  generate(input: PlanInput): Promise<PlanOutput>;
}
