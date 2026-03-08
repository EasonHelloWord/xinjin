import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "./authMiddleware";
import { getDb } from "./db";
import { badRequest, forbidden } from "./errors";
import { getProviders } from "./providers/factory";
import { UserLevel } from "./providers/types";

const assessmentSubmitSchema = z.object({
  answers: z.array(z.number().int().min(1).max(5)).min(5).max(30)
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
  risk_notice: string | null;
  created_at: number;
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

const computeAssessmentScore = (answers: number[]): number => {
  const total = answers.reduce((sum, value) => sum + value, 0);
  const max = answers.length * 5;
  return Math.round((total / max) * 100);
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

const toAssessmentResponse = (row: AssessmentRow) => ({
  id: row.id,
  score: row.score,
  level: row.level,
  answers: parseJsonNumberArray(row.answers_json),
  createdAt: row.created_at
});

const toAnalysisResponse = (row: AnalysisRow) => ({
  id: row.id,
  assessmentId: row.assessment_id,
  inputText: row.input_text,
  sleepHours: row.sleep_hours,
  fatigueLevel: row.fatigue_level,
  socialWillingness: row.social_willingness,
  emotionTags: parseJsonStringArray(row.emotion_tags_json),
  contradictions: parseJsonStringArray(row.contradictions_json),
  summary: row.summary,
  stateType: row.state_type,
  tcmAdvice: parseJsonStringArray(row.tcm_advice_json),
  westernAdvice: parseJsonStringArray(row.western_advice_json),
  microTasks: parseJsonStringArray(row.micro_tasks_json),
  riskNotice: row.risk_notice,
  createdAt: row.created_at
});

const getLatestAssessment = async (userId: string): Promise<AssessmentRow | null> => {
  const db = await getDb();
  const row = await db.get<AssessmentRow>(
    `
      SELECT id, user_id, score, level, answers_json, created_at
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
      const score = computeAssessmentScore(parsed.data.answers);
      const level = scoreToLevel(score);
      const createdAt = Date.now();
      const id = randomUUID();
      const db = await getDb();

      await db.run(
        `
          INSERT INTO assessment_records (id, user_id, score, level, answers_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        id,
        userId,
        score,
        level,
        JSON.stringify(parsed.data.answers),
        createdAt
      );

      return {
        id,
        score,
        level,
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
              SELECT id, user_id, score, level, answers_json, created_at
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

      const level: UserLevel = assessment?.level || "mild";
      const analyzeOut = await emotionAnalyzer.analyze({
        text: parsed.data.text,
        level,
        sleepHours: parsed.data.sleepHours,
        fatigueLevel: parsed.data.fatigueLevel,
        socialWillingness: parsed.data.socialWillingness
      });

      const planOut = await planGenerator.generate({
        level,
        stateType: analyzeOut.stateType,
        summary: analyzeOut.summary
      });

      const id = randomUUID();
      const createdAt = Date.now();

      await db.run(
        `
          INSERT INTO state_analyses (
            id, user_id, assessment_id, input_text, sleep_hours, fatigue_level, social_willingness,
            emotion_tags_json, contradictions_json, summary, state_type,
            tcm_advice_json, western_advice_json, micro_tasks_json, risk_notice, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        userId,
        assessment?.id || null,
        parsed.data.text,
        parsed.data.sleepHours ?? null,
        parsed.data.fatigueLevel ?? null,
        parsed.data.socialWillingness ?? null,
        JSON.stringify(analyzeOut.emotionTags),
        JSON.stringify(analyzeOut.contradictions),
        analyzeOut.summary,
        analyzeOut.stateType,
        JSON.stringify(planOut.tcmAdvice),
        JSON.stringify(planOut.westernAdvice),
        JSON.stringify(planOut.microTasks),
        planOut.riskNotice ?? null,
        createdAt
      );

      return {
        id,
        assessmentId: assessment?.id || null,
        score: assessment?.score ?? null,
        level,
        ...analyzeOut,
        ...planOut,
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
              tcm_advice_json, western_advice_json, micro_tasks_json, risk_notice, created_at
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
          SELECT id, user_id, score, level, answers_json, created_at
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
            tcm_advice_json, western_advice_json, micro_tasks_json, risk_notice, created_at
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
