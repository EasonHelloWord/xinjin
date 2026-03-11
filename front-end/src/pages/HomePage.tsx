import { useEffect, useMemo, useRef, useState } from "react";
import { ChatDock } from "../chat/ChatDock";
import { CloudController } from "../engine/CloudController";
import { CloudEngine } from "../engine/CloudEngine";
import { AnalysisResult, api, AssessmentResult, StateType, UserLevel } from "../lib/api";
import { emitPulse, onPulse } from "../lib/pulseBus";

interface HomePageProps {
  onLogout: () => void;
}

type WorkflowStage = "assessment" | "result";

type AssessmentQuestion = {
  id: number;
  text: string;
};

const ASSESSMENT_QUESTIONS: AssessmentQuestion[] = [
  { id: 1, text: "我感到焦虑、紧张或烦躁不安。" },
  { id: 2, text: "我能在一天中体验到愉悦和满足的时刻。" },
  { id: 3, text: "一些小事就能轻易地激怒我或让我感到沮丧。" },
  { id: 4, text: "我觉得内心平静而安稳。" },
  { id: 5, text: "我会突然感到一阵悲伤，甚至想哭。" },
  { id: 6, text: "我对自己是满意的，接纳自己现在的样子。" },
  { id: 7, text: "我觉得自己很失败，不如别人。" },
  { id: 8, text: "当我需要帮助时，有人可以依靠。" },
  { id: 9, text: "我经常感到孤独，觉得被他人疏远。" },
  { id: 10, text: "我相信自己能处理好生活中的大多数难题。" },
  { id: 11, text: "我感到精力充沛，做事有干劲。" },
  { id: 12, text: "我睡眠质量很差，或者睡醒后依然觉得很累。" },
  { id: 13, text: "我食欲正常，享受进食的过程。" },
  { id: 14, text: "我常常感到身体疲惫，做什么都提不起劲。" },
  { id: 15, text: "我能专注于我正在做的事情（如工作、学习、娱乐）。" },
  { id: 16, text: "我觉得生活很有意义，对未来有期待。" },
  { id: 17, text: "我感到迷茫，不知道前进的方向在哪里。" },
  { id: 18, text: "即使遇到困难，我也倾向于坚持下去。" },
  { id: 19, text: "我觉得生活很乏味，没什么意思。" },
  { id: 20, text: "总的来说，我对未来的生活持乐观态度。" }
];

const OPTION_LABELS = [
  { value: 1, label: "A", text: "完全不符合" },
  { value: 2, label: "B", text: "比较不符合" },
  { value: 3, label: "C", text: "不确定 / 有时符合" },
  { value: 4, label: "D", text: "比较符合" },
  { value: 5, label: "E", text: "完全符合" }
] as const;

const REVERSED_QUESTION_IDS = new Set([1, 3, 5, 7, 9, 12, 14, 17, 19]);

const shuffleQuestions = (questions: AssessmentQuestion[]): AssessmentQuestion[] => {
  const next = [...questions];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const levelLabel = (level: UserLevel): string => {
  if (level === "healthy") return "健康";
  if (level === "mild") return "轻度波动";
  if (level === "moderate") return "中度波动";
  return "重度风险";
};

const stateTypeLabel = (stateType: StateType): string => {
  if (stateType === "sensory_overload") return "感官过载型";
  if (stateType === "emotional_block") return "情感屏蔽型";
  return "波动混合型";
};

const resolveSixDimAdvice = (analysisResult: AnalysisResult) => {
  const six = analysisResult.sixDimAdvice;
  if (six?.body && six?.emotion && six?.cognition && six?.behavior && six?.relation && six?.environment) {
    return six;
  }

  return {
    body: analysisResult.tcmAdvice?.[0] ?? "",
    emotion: analysisResult.tcmAdvice?.[1] ?? "",
    cognition: analysisResult.tcmAdvice?.[2] ?? "",
    behavior: analysisResult.westernAdvice?.[0] ?? "",
    relation: analysisResult.westernAdvice?.[1] ?? "",
    environment: analysisResult.westernAdvice?.[2] ?? ""
  };
};

const DIMENSION_LEFT = [
  { key: "body", title: "身体调理", emoji: "🫁" },
  { key: "emotion", title: "情绪调理", emoji: "💛" },
  { key: "cognition", title: "认知调理", emoji: "🧠" }
] as const;

const DIMENSION_RIGHT = [
  { key: "behavior", title: "行为调理", emoji: "🚶" },
  { key: "relation", title: "关系调理", emoji: "🤝" },
  { key: "environment", title: "环境调理", emoji: "🌿" }
] as const;

export function HomePage({ onLogout }: HomePageProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [initLoading, setInitLoading] = useState(true);
  const [stage, setStage] = useState<WorkflowStage>("assessment");
  const [assessmentAnswers, setAssessmentAnswers] = useState<number[]>(() => ASSESSMENT_QUESTIONS.map(() => 3));
  const [displayQuestions, setDisplayQuestions] = useState<AssessmentQuestion[]>(() => shuffleQuestions(ASSESSMENT_QUESTIONS));
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [adviceUpdating, setAdviceUpdating] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const pulseEnergyRef = useRef(0);
  const pulseRafRef = useRef<number | null>(null);
  const adviceReqSeqRef = useRef(0);
  const recentUserTextsRef = useRef<string[]>([]);
  const sixDimAdvice = analysisResult ? resolveSixDimAdvice(analysisResult) : null;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const engine = new CloudEngine(el, controller);
    engine.init();
    return () => engine.dispose();
  }, [controller]);

  useEffect(() => {
    const restoreLatest = async (): Promise<void> => {
      try {
        const summary = await api.getProfileSummary();
        if (summary.latestAssessment) {
          const { id, score, level, sectionScores, createdAt } = summary.latestAssessment;
          setAssessmentResult({ id, score, level, sectionScores, createdAt });
        }
        if (summary.latestAnalysis) {
          setAnalysisResult(summary.latestAnalysis);
          setStage("result");
        } else {
          setStage("assessment");
          setDisplayQuestions(shuffleQuestions(ASSESSMENT_QUESTIONS));
        }
      } catch {
        setStage("assessment");
        setDisplayQuestions(shuffleQuestions(ASSESSMENT_QUESTIONS));
      } finally {
        setInitLoading(false);
      }
    };
    void restoreLatest();
  }, []);

  useEffect(() => {
    controller.setStageCenterYOffset(-0.08);
  }, [controller]);

  useEffect(() => {
    const offPulse = onPulse((v) => {
      pulseEnergyRef.current = Math.min(1, pulseEnergyRef.current + Math.max(0.06, v));
    });

    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      pulseEnergyRef.current *= 0.86;
      const scale = 1 + pulseEnergyRef.current * 0.24;
      controller.applyConfig("cloud.sphereRadius", scale);
      pulseRafRef.current = requestAnimationFrame(tick);
    };
    pulseRafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      offPulse();
      if (pulseRafRef.current !== null) {
        cancelAnimationFrame(pulseRafRef.current);
      }
      controller.applyConfig("cloud.sphereRadius", 1);
    };
  }, [controller]);

  const submitAssessment = async (): Promise<void> => {
    if (assessmentLoading) return;
    setFlowError(null);
    setAssessmentLoading(true);
    try {
      const normalizedAnswers = assessmentAnswers
        .slice(0, ASSESSMENT_QUESTIONS.length)
        .map((value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) return 3;
          return Math.max(1, Math.min(5, Math.round(n)));
        });

      if (normalizedAnswers.length !== 20) {
        throw new Error("问卷题目不足，无法提交评估");
      }

      const result = await api.submitAssessment(normalizedAnswers);
      setAssessmentResult(result);

      const analysis = await api.analyzeState({
        assessmentId: result.id,
        text: "用户已完成20题心理状态问卷，请结合总分与分部分得分，给出首轮状态提示，并按身体、情绪、认知、行为、关系、环境六个维度分别给出1条可执行建议，同时给出今日微任务。"
      });
      setAnalysisResult(analysis);
      setStage("result");
      emitPulse(0.55);
    } catch (err) {
      setFlowError((err as Error).message);
    } finally {
      setAssessmentLoading(false);
    }
  };

  const restartFlow = (): void => {
    setStage("assessment");
    setAssessmentResult(null);
    setAnalysisResult(null);
    setAdviceUpdating(false);
    setAssessmentAnswers(ASSESSMENT_QUESTIONS.map(() => 3));
    setDisplayQuestions(shuffleQuestions(ASSESSMENT_QUESTIONS));
    recentUserTextsRef.current = [];
    emitPulse(0.2);
  };

  const refreshAdviceFromChat = async (payload: { userText: string }): Promise<void> => {
    if (!assessmentResult?.id) return;
    const trimmed = payload.userText.trim();
    if (!trimmed) return;
    recentUserTextsRef.current = [...recentUserTextsRef.current, trimmed].slice(-6);

    const seq = ++adviceReqSeqRef.current;
    setAdviceUpdating(true);
    try {
      const recentText = recentUserTextsRef.current.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
      const analysis = await api.analyzeState({
        assessmentId: assessmentResult.id,
        text: `以下是用户最近多轮原始输入（按时间从早到晚）：\n${recentText}\n请优先评估情绪波动幅度、风险信号与稳定性，再更新状态提示和建议。`
      });
      if (seq === adviceReqSeqRef.current) {
        setAnalysisResult(analysis);
      }
    } catch {
      // Keep the existing panel content on refresh failure.
    } finally {
      if (seq === adviceReqSeqRef.current) {
        setAdviceUpdating(false);
      }
    }
  };

  return (
    <div className="home-layout">
      <div className={`cloud-stage ${stage === "assessment" || initLoading ? "hidden" : ""}`} ref={canvasRef} />

      {stage === "result" && analysisResult && (
        <>
          <div className="state-hint-box">
            <div className="state-hint-title">{"🧭 状态提示"}</div>
            <div className="state-hint-text">{`${stateTypeLabel(analysisResult.stateType)} ｜ ${levelLabel(analysisResult.level)}`}</div>
            {adviceUpdating && <div className="state-hint-sub">{"正在根据最新聊天更新建议..."}</div>}
            {analysisResult.riskNotice && <div className="state-hint-risk">{`⚠️ ${analysisResult.riskNotice}`}</div>}
          </div>

          <aside className="mind-side mind-side-left">
            <h3>{"六维调理（左）"}</h3>
            {DIMENSION_LEFT.map((item) => (
              <article key={item.key} className="advice-block">
                <div className="advice-title">{`${item.emoji} ${item.title}`}</div>
                <div className="advice-body">{sixDimAdvice?.[item.key] ?? ""}</div>
              </article>
            ))}
          </aside>
          <aside className="mind-side mind-side-right">
            <h3>{"六维调理（右）"}</h3>
            {DIMENSION_RIGHT.map((item) => (
              <article key={item.key} className="advice-block">
                <div className="advice-title">{`${item.emoji} ${item.title}`}</div>
                <div className="advice-body">{sixDimAdvice?.[item.key] ?? ""}</div>
              </article>
            ))}
            <div className="advice-title">{"✨ 今日微任务"}</div>
            <div className="task-list">
              {analysisResult.microTasks.map((item, idx) => (
                <span key={item}>{`${idx + 1}. ${item}`}</span>
              ))}
            </div>
          </aside>
        </>
      )}

      {initLoading && (
        <div className="assessment-screen">
          <div className="assessment-inner assessment-loading">
            <h1>{"加载中"}</h1>
            <p>{"正在恢复你上次的评估与建议..."}</p>
          </div>
        </div>
      )}

      {!initLoading && stage === "assessment" && (
        <div className="assessment-screen">
          <div className="assessment-inner">
            <h1>{"注册评估"}</h1>
            <p>{"以下20个句子是关于您过去一周内日常生活与内心感受的描述。请根据您的实际体验，选择最符合您情况的选项。答案无对错之分，请凭直觉快速作答。"}</p>
            <div className="survey-list">
              {displayQuestions.map((question) => {
                const idx = question.id - 1;
                const isReversed = REVERSED_QUESTION_IDS.has(question.id);
                return (
                  <div key={question.id} className="survey-item">
                    <span>{question.text}</span>
                    <div className="survey-options">
                      {OPTION_LABELS.map((opt) => (
                        <label key={`${question.id}-${opt.value}`} className="survey-option">
                          <input
                            type="radio"
                            name={`q-${question.id}`}
                            value={opt.value}
                            checked={assessmentAnswers[idx] === opt.value}
                            onChange={() =>
                              setAssessmentAnswers((prev) =>
                                prev.map((value, i) => (i === idx ? opt.value : value))
                              )
                            }
                          />
                          <span>{`${opt.label}. ${opt.text}（${isReversed ? 6 - opt.value : opt.value}分）`}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={submitAssessment} disabled={assessmentLoading}>
              {assessmentLoading ? "评估中..." : "提交评估"}
            </button>
            {flowError && <div className="message-box">{flowError}</div>}
          </div>
        </div>
      )}

      {stage === "result" && (
        <ChatDock
          onLogout={onLogout}
          chatEnabled={true}
          onRequestReassess={restartFlow}
          onAdviceRefresh={(payload) => void refreshAdviceFromChat(payload)}
          assessmentLabel={
            assessmentResult
              ? `${levelLabel(assessmentResult.level)} (${assessmentResult.score}分)${
                  assessmentResult.sectionScores
                    ? `｜情绪${assessmentResult.sectionScores.emotion} 自我关系${assessmentResult.sectionScores.selfAndRelation} 身体活力${assessmentResult.sectionScores.bodyAndVitality} 意义希望${assessmentResult.sectionScores.meaningAndHope}`
                    : ""
                }`
              : ""
          }
        />
      )}
    </div>
  );
}
