import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "./authMiddleware";
import { getDb } from "./db";
import { badRequest, forbidden } from "./errors";
import { getProviders } from "./providers/factory";
import { AdviceConfidence, AssessmentSectionScores, SixDimAdvice, StateType, UserLevel } from "./providers/types";

const assessmentSubmitSchema = z.object({
  answers: z.array(z.number().int().min(1).max(5)).length(20)
});

const analyzeSchema = z.object({
  assessmentId: z.string().optional(),
  text: z.string().trim().min(1).max(2000),
  sleepHours: z.number().min(0).max(24).optional(),
  fatigueLevel: z.number().int().min(1).max(5).optional(),
  socialWillingness: z.number().int().min(1).max(5).optional()
});

type AssessmentRow = {
  id: string;
  user_id: string;
  score: number;
  level: UserLevel;
  answers_json: string;
  section_scores_json: string;
  created_at: number;
};

type AnalysisRow = {
  id: string;
  user_id: string;
  assessment_id: string | null;
  input_text: string;
  sleep_hours: number | null;
  fatigue_level: number | null;
  social_willingness: number | null;
  emotion_tags_json: string;
  contradictions_json: string;
  summary: string;
  state_type: string;
  tcm_advice_json: string;
  western_advice_json: string;
  micro_tasks_json: string;
  confidence_json: string;
  risk_notice: string | null;
  created_at: number;
};

const LEVEL_RANK: Record<UserLevel, number> = {
  healthy: 0,
  mild: 1,
  moderate: 2,
  severe: 3
};

const rankToLevel = (rank: number): UserLevel => {
  if (rank >= 3) return "severe";
  if (rank >= 2) return "moderate";
  if (rank >= 1) return "mild";
  return "healthy";
};

const elevateLevel = (base: UserLevel, minLevel?: UserLevel): UserLevel => {
  if (!minLevel) return base;
  return rankToLevel(Math.max(LEVEL_RANK[base], LEVEL_RANK[minLevel]));
};

const containsAny = (text: string, words: string[]): number => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

const DANGER_WORDS = [
  "不想活",
  "活不下去",
  "结束生命",
  "自杀",
  "自残",
  "伤害自己",
  "杀了自己",
  "想死",
  "去死",
  "割腕",
  "跳楼"
];

const NEGATIVE_WORDS = [
  "崩溃",
  "绝望",
  "失控",
  "痛苦",
  "焦虑",
  "恐慌",
  "害怕",
  "伤心",
  "难受",
  "压抑",
  "烦躁",
  "愤怒",
  "暴躁"
];

const POSITIVE_WORDS = [
  "开心",
  "高兴",
  "兴奋",
  "快乐",
  "轻松",
  "哈哈",
  "乐观",
  "满足"
];

const evaluateSafetySignals = (textRaw: string): {
  minLevel?: UserLevel;
  riskNotice?: string;
  appendSummary?: string;
  forceStateTypeMixed: boolean;
  confidencePenalty: number;
} => {
  const text = textRaw.toLowerCase();
  const dangerHits = containsAny(text, DANGER_WORDS);
  const negativeHits = containsAny(text, NEGATIVE_WORDS);
  const positiveHits = containsAny(text, POSITIVE_WORDS);
  const exclamationCount = (text.match(/[!！?？]/g) || []).length;
  const volatilitySignal = negativeHits > 0 && positiveHits > 0;
  const highArousal = exclamationCount >= 4;
  const strongVolatility =
    volatilitySignal &&
    ((negativeHits >= 3 && positiveHits >= 2) || (highArousal && negativeHits >= 2 && positiveHits >= 1));

  if (dangerHits > 0) {
    return {
      minLevel: "severe",
      riskNotice:
        "检测到自伤/轻生相关高危信号。请立即联系当地急救电话、心理危机干预热线或身边可信任的人，并尽快前往专业医疗机构。",
      appendSummary: "当前存在高危安全信号，需优先进行危机安全干预，而不是仅做日常情绪管理。",
      forceStateTypeMixed: true,
      confidencePenalty: 0.18
    };
  }

  if (strongVolatility) {
    return {
      minLevel: "moderate",
      riskNotice:
        "检测到短时间内明显的情绪剧烈波动。建议尽快进行专业心理评估，并建立24-72小时的情绪与睡眠监测。",
      appendSummary: "当前更符合“情绪波动幅度较大”的状态，需优先稳定情绪振幅与节律。",
      forceStateTypeMixed: true,
      confidencePenalty: 0.1
    };
  }

  if (negativeHits >= 4 && highArousal) {
    return {
      minLevel: "moderate",
      appendSummary: "文本中持续出现高负荷情绪信号，建议提高警惕并增加支持资源。",
      forceStateTypeMixed: false,
      confidencePenalty: 0.08
    };
  }

  return {
    forceStateTypeMixed: false,
    confidencePenalty: 0
  };
};

const EMOTION_TAG_ALIAS: Record<string, string> = {
  anxiety: "有些焦虑",
  anxious: "有些焦虑",
  stress: "感到压力",
  stressed: "感到压力",
  fatigue: "有点疲惫",
  tired: "有点疲惫",
  numbness: "情绪发空",
  numb: "情绪发空",
  irritability: "有些烦躁",
  anger: "带着愤怒",
  angry: "带着愤怒",
  sadness: "有些悲伤",
  sad: "有些悲伤",
  fear: "带着害怕",
  panic: "有些恐慌",
  low_stability: "状态波动",
  stable_moment: "相对平稳",
  self_adjusting: "自我调节中",
  seeking_support: "愿意求助",
  hopeful: "保有期待",
  self_awareness: "有所觉察"
};

const normalizeEmotionTag = (raw: string): string => {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return "";
  if (EMOTION_TAG_ALIAS[normalized]) return EMOTION_TAG_ALIAS[normalized];
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(0, 8);
  return "";
};

const normalizeEmotionTags = (tags: string[]): string[] => {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const cn = normalizeEmotionTag(tag);
    if (!cn || seen.has(cn)) continue;
    seen.add(cn);
    next.push(cn);
    if (next.length >= 6) break;
  }
  if (next.length === 0) next.push("状态波动");
  return next;
};

const HIGH_RISK_NOTICE_HINTS = ["高危", "危机", "自伤", "轻生", "自杀", "急救", "热线", "立即", "尽快"];
const shouldDisplayRiskNotice = (notice: string | undefined, level: UserLevel, fromSafety: boolean): boolean => {
  if (!notice || !notice.trim()) return false;
  if (fromSafety) return true;
  if (level === "severe") return true;
  return HIGH_RISK_NOTICE_HINTS.some((word) => notice.includes(word));
};

const asUserId = (request: FastifyRequest): string => {
  if (!request.authUserId) {
    throw forbidden("User is not authenticated");
  }
  return request.authUserId;
};

const scoreToLevel = (score: number): UserLevel => {
  if (score >= 85) return "healthy";
  if (score >= 60) return "mild";
  if (score >= 40) return "moderate";
  return "severe";
};

const REVERSED_QUESTION_INDEX = new Set([0, 2, 4, 6, 8, 11, 13, 16, 18]);

const computeAssessmentScore = (answers: number[]): { total: number; sectionScores: AssessmentSectionScores } => {
  const scored = answers.map((value, idx) => (REVERSED_QUESTION_INDEX.has(idx) ? 6 - value : value));
  const sectionScores: AssessmentSectionScores = {
    emotion: scored.slice(0, 5).reduce((sum, value) => sum + value, 0),
    selfAndRelation: scored.slice(5, 10).reduce((sum, value) => sum + value, 0),
    bodyAndVitality: scored.slice(10, 15).reduce((sum, value) => sum + value, 0),
    meaningAndHope: scored.slice(15, 20).reduce((sum, value) => sum + value, 0)
  };
  const total = scored.reduce((sum, value) => sum + value, 0);
  return { total, sectionScores };
};

const parseJsonStringArray = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseJsonNumberArray = (raw: string): number[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  } catch {
    return [];
  }
};

const normalizeSixDimAdvice = (raw: Partial<SixDimAdvice> | null | undefined): SixDimAdvice => ({
  body: typeof raw?.body === "string" ? raw.body : "",
  emotion: typeof raw?.emotion === "string" ? raw.emotion : "",
  cognition: typeof raw?.cognition === "string" ? raw.cognition : "",
  behavior: typeof raw?.behavior === "string" ? raw.behavior : "",
  relation: typeof raw?.relation === "string" ? raw.relation : "",
  environment: typeof raw?.environment === "string" ? raw.environment : ""
});

const sixDimFromLegacyArrays = (left: string[], right: string[]): SixDimAdvice =>
  normalizeSixDimAdvice({
    body: left[0],
    emotion: left[1],
    cognition: left[2],
    behavior: right[0],
    relation: right[1],
    environment: right[2]
  });

const parseSectionScores = (raw: string): AssessmentSectionScores | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<AssessmentSectionScores>;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.emotion !== "number" ||
      typeof parsed.selfAndRelation !== "number" ||
      typeof parsed.bodyAndVitality !== "number" ||
      typeof parsed.meaningAndHope !== "number"
    ) {
      return null;
    }
    return {
      emotion: parsed.emotion,
      selfAndRelation: parsed.selfAndRelation,
      bodyAndVitality: parsed.bodyAndVitality,
      meaningAndHope: parsed.meaningAndHope
    };
  } catch {
    return null;
  }
};

const parseConfidence = (raw: string): AdviceConfidence | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<AdviceConfidence>;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.state !== "number" ||
      typeof parsed.tcm !== "number" ||
      typeof parsed.western !== "number"
    ) {
      return null;
    }
    return {
      state: Math.max(0, Math.min(1, parsed.state)),
      tcm: Math.max(0, Math.min(1, parsed.tcm)),
      western: Math.max(0, Math.min(1, parsed.western))
    };
  } catch {
    return null;
  }
};

const normalizeStateType = (raw: string): StateType => {
  if (raw === "sensory_overload" || raw === "emotional_block" || raw === "mixed_fluctuation" || raw === "stable_normal") {
    return raw;
  }
  if (raw === "self_regulating" || raw === "resource_recovering") {
    return "stable_normal";
  }
  return "mixed_fluctuation";
};

const toAssessmentResponse = (row: AssessmentRow) => ({
  id: row.id,
  score: row.score,
  level: row.level,
  answers: parseJsonNumberArray(row.answers_json),
  sectionScores: parseSectionScores(row.section_scores_json),
  createdAt: row.created_at
});

const toAnalysisResponse = (row: AnalysisRow) => ({
  ...(() => {
    const left = parseJsonStringArray(row.tcm_advice_json);
    const right = parseJsonStringArray(row.western_advice_json);
    const sixDimAdvice = sixDimFromLegacyArrays(left, right);
    return {
      tcmAdvice: left,
      westernAdvice: right,
      sixDimAdvice
    };
  })(),
  id: row.id,
  assessmentId: row.assessment_id,
  inputText: row.input_text,
  sleepHours: row.sleep_hours,
  fatigueLevel: row.fatigue_level,
  socialWillingness: row.social_willingness,
  emotionTags: normalizeEmotionTags(parseJsonStringArray(row.emotion_tags_json)),
  contradictions: parseJsonStringArray(row.contradictions_json),
  summary: row.summary,
  stateType: normalizeStateType(row.state_type),
  microTasks: parseJsonStringArray(row.micro_tasks_json),
  confidence: parseConfidence(row.confidence_json),
  riskNotice: row.risk_notice,
  createdAt: row.created_at
});

const getLatestAssessment = async (userId: string): Promise<AssessmentRow | null> => {
  const db = await getDb();
  const row = await db.get<AssessmentRow>(
    `
      SELECT id, user_id, score, level, answers_json, section_scores_json, created_at
      FROM assessment_records
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    userId
  );
  return row ?? null;
};

export const registerMindRoutes = async (fastify: FastifyInstance): Promise<void> => {
  const { emotionAnalyzer, planGenerator, providerName } = getProviders();
  fastify.log.info({ providerName }, "Mind routes using AI provider");

  fastify.route({
    method: "POST",
    url: "/api/assessment/submit",
    preHandler: authMiddleware,
    handler: async (request) => {
      const parsed = assessmentSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }

      const userId = asUserId(request);
      const { total: score, sectionScores } = computeAssessmentScore(parsed.data.answers);
      const level = scoreToLevel(score);
      const createdAt = Date.now();
      const id = randomUUID();
      const db = await getDb();

      await db.run(
        `
          INSERT INTO assessment_records (id, user_id, score, level, answers_json, section_scores_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        userId,
        score,
        level,
        JSON.stringify(parsed.data.answers),
        JSON.stringify(sectionScores),
        createdAt
      );

      return {
        id,
        score,
        level,
        sectionScores,
        createdAt
      };
    }
  });

  fastify.route({
    method: "POST",
    url: "/api/state/analyze",
    preHandler: authMiddleware,
    handler: async (request) => {
      const parsed = analyzeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw badRequest("INVALID_INPUT", parsed.error.issues.map((item) => item.message).join("; "));
      }

      const userId = asUserId(request);
      const db = await getDb();

      let assessment = parsed.data.assessmentId
        ? await db.get<AssessmentRow>(
            `
              SELECT id, user_id, score, level, answers_json, section_scores_json, created_at
              FROM assessment_records
              WHERE id = ? AND user_id = ?
            `,
            parsed.data.assessmentId,
            userId
          )
        : null;

      if (!assessment) {
        assessment = await getLatestAssessment(userId);
      }

      const baseLevel: UserLevel = assessment?.level || "mild";
      const sectionScores = assessment ? parseSectionScores(assessment.section_scores_json) : null;
      const safety = evaluateSafetySignals(parsed.data.text);
      const level = elevateLevel(baseLevel, safety.minLevel);
      const analyzeOut = await emotionAnalyzer.analyze({
        text: parsed.data.text,
        level,
        sleepHours: parsed.data.sleepHours,
        fatigueLevel: parsed.data.fatigueLevel,
        socialWillingness: parsed.data.socialWillingness,
        assessmentScore: assessment?.score,
        assessmentSectionScores: sectionScores ?? undefined
      });

      const planOut = await planGenerator.generate({
        level,
        stateType: safety.forceStateTypeMixed ? "mixed_fluctuation" : analyzeOut.stateType,
        summary:
          safety.appendSummary && !analyzeOut.summary.includes(safety.appendSummary)
            ? `${analyzeOut.summary} ${safety.appendSummary}`
            : analyzeOut.summary
      });

      const finalStateType = safety.forceStateTypeMixed ? "mixed_fluctuation" : analyzeOut.stateType;
      const finalSummary =
        safety.appendSummary && !analyzeOut.summary.includes(safety.appendSummary)
          ? `${analyzeOut.summary} ${safety.appendSummary}`
          : analyzeOut.summary;
      const normalizedEmotionTags = normalizeEmotionTags(analyzeOut.emotionTags);
      const confidence: AdviceConfidence = {
        state: Math.max(0, Math.min(1, (analyzeOut.stateConfidence ?? 0.65) - safety.confidencePenalty)),
        tcm: Math.max(0, Math.min(1, (planOut.tcmConfidence ?? 0.68) - safety.confidencePenalty * 0.6)),
        western: Math.max(0, Math.min(1, (planOut.westernConfidence ?? 0.68) - safety.confidencePenalty * 0.6))
      };
      const mergedRiskNotice = safety.riskNotice ?? planOut.riskNotice;
      const finalRiskNotice = shouldDisplayRiskNotice(mergedRiskNotice, level, Boolean(safety.riskNotice))
        ? mergedRiskNotice
        : null;

      const id = randomUUID();
      const createdAt = Date.now();

      await db.run(
        `
          INSERT INTO state_analyses (
            id, user_id, assessment_id, input_text, sleep_hours, fatigue_level, social_willingness,
            emotion_tags_json, contradictions_json, summary, state_type,
            tcm_advice_json, western_advice_json, micro_tasks_json, confidence_json, risk_notice, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        userId,
        assessment?.id || null,
        parsed.data.text,
        parsed.data.sleepHours ?? null,
        parsed.data.fatigueLevel ?? null,
        parsed.data.socialWillingness ?? null,
        JSON.stringify(normalizedEmotionTags),
        JSON.stringify(analyzeOut.contradictions),
        finalSummary,
        finalStateType,
        JSON.stringify([planOut.sixDimAdvice.body, planOut.sixDimAdvice.emotion, planOut.sixDimAdvice.cognition]),
        JSON.stringify([planOut.sixDimAdvice.behavior, planOut.sixDimAdvice.relation, planOut.sixDimAdvice.environment]),
        JSON.stringify(planOut.microTasks),
        JSON.stringify(confidence),
        finalRiskNotice,
        createdAt
      );

      return {
        id,
        assessmentId: assessment?.id || null,
        score: assessment?.score ?? null,
        level,
        ...analyzeOut,
        emotionTags: normalizedEmotionTags,
        summary: finalSummary,
        stateType: finalStateType,
        ...planOut,
        tcmAdvice: [planOut.sixDimAdvice.body, planOut.sixDimAdvice.emotion, planOut.sixDimAdvice.cognition],
        westernAdvice: [planOut.sixDimAdvice.behavior, planOut.sixDimAdvice.relation, planOut.sixDimAdvice.environment],
        confidence,
        riskNotice: finalRiskNotice,
        createdAt
      };
    }
  });

  fastify.route({
    method: "GET",
    url: "/api/profile/summary",
    preHandler: authMiddleware,
    handler: async (request) => {
      const userId = asUserId(request);
      const db = await getDb();

      const latestAssessment = await getLatestAssessment(userId);
      const latestAnalysis =
        (await db.get<AnalysisRow>(
          `
            SELECT
              id, user_id, assessment_id, input_text, sleep_hours, fatigue_level, social_willingness,
              emotion_tags_json, contradictions_json, summary, state_type,
              tcm_advice_json, western_advice_json, micro_tasks_json, confidence_json, risk_notice, created_at
            FROM state_analyses
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `,
          userId
        )) ?? null;

      return {
        latestAssessment: latestAssessment ? toAssessmentResponse(latestAssessment) : null,
        latestAnalysis: latestAnalysis ? toAnalysisResponse(latestAnalysis) : null
      };
    }
  });

  fastify.route({
    method: "GET",
    url: "/api/profile/timeline",
    preHandler: authMiddleware,
    handler: async (request) => {
      const userId = asUserId(request);
      const db = await getDb();

      const assessments = await db.all<AssessmentRow[]>(
        `
          SELECT id, user_id, score, level, answers_json, section_scores_json, created_at
          FROM assessment_records
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 60
        `,
        userId
      );

      const analyses = await db.all<AnalysisRow[]>(
        `
          SELECT
            id, user_id, assessment_id, input_text, sleep_hours, fatigue_level, social_willingness,
            emotion_tags_json, contradictions_json, summary, state_type,
            tcm_advice_json, western_advice_json, micro_tasks_json, confidence_json, risk_notice, created_at
          FROM state_analyses
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 60
        `,
        userId
      );

      return {
        assessments: assessments.map(toAssessmentResponse).reverse(),
        analyses: analyses.map(toAnalysisResponse).reverse()
      };
    }
  });
};
