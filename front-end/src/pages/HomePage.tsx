import { useEffect, useMemo, useRef, useState } from "react";
import { ChatDock } from "../chat/ChatDock";
import { CloudController } from "../engine/CloudController";
import { CloudEngine } from "../engine/CloudEngine";
import { AnalysisResult, api, AssessmentResult, StateType, UserLevel } from "../lib/api";
import { emitPulse, onPulse } from "../lib/pulseBus";

interface HomePageProps {
  onLogout: () => void;
}

type WorkflowStage = "assessment" | "state_input" | "result";

const ASSESSMENT_QUESTIONS = [
  "最近一周，你是否经常感到精力不足？",
  "最近一周，你是否很难专注在学习或任务上？",
  "最近一周，你是否出现明显焦虑或烦躁？",
  "最近一周，你是否回避社交或沟通？",
  "最近一周，你的睡眠质量是否稳定？（反向）",
  "最近一周，你是否能较快从负面情绪恢复？（反向）"
];

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

export function HomePage({ onLogout }: HomePageProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [stage, setStage] = useState<WorkflowStage>("assessment");
  const [assessmentAnswers, setAssessmentAnswers] = useState<number[]>(() => ASSESSMENT_QUESTIONS.map(() => 3));
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [stateText, setStateText] = useState("");
  const [sleepHours, setSleepHours] = useState("7");
  const [fatigueLevel, setFatigueLevel] = useState<number>(3);
  const [socialWillingness, setSocialWillingness] = useState<number>(3);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const pulseEnergyRef = useRef(0);
  const pulseRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const engine = new CloudEngine(el, controller);
    engine.init();
    return () => engine.dispose();
  }, [controller]);

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
      const result = await api.submitAssessment(assessmentAnswers);
      setAssessmentResult(result);
      setStage("state_input");
      emitPulse(0.35);
    } catch (err) {
      setFlowError((err as Error).message);
    } finally {
      setAssessmentLoading(false);
    }
  };

  const submitStateAnalyze = async (): Promise<void> => {
    if (analysisLoading) return;
    const text = stateText.trim();
    if (!text) return;

    setFlowError(null);
    setAnalysisLoading(true);
    try {
      const result = await api.analyzeState({
        assessmentId: assessmentResult?.id,
        text,
        sleepHours: Number.isFinite(Number(sleepHours)) ? Number(sleepHours) : undefined,
        fatigueLevel,
        socialWillingness
      });
      setAnalysisResult(result);
      setStage("result");
      emitPulse(0.55);
    } catch (err) {
      setFlowError((err as Error).message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const restartFlow = (): void => {
    setStage("assessment");
    setAssessmentResult(null);
    setAnalysisResult(null);
    setStateText("");
    setAssessmentAnswers(ASSESSMENT_QUESTIONS.map(() => 3));
    emitPulse(0.2);
  };

  return (
    <div className="home-layout">
      <div className={`cloud-stage ${stage === "assessment" || stage === "state_input" ? "hidden" : ""}`} ref={canvasRef} />

      {stage === "result" && analysisResult && (
        <>
          <aside className="mind-side mind-side-left">
            <h3>{"中医调理"}</h3>
            {analysisResult.tcmAdvice.map((item) => (
              <div key={item} className="advice-item">
                {item}
              </div>
            ))}
          </aside>
          <aside className="mind-side mind-side-right">
            <h3>{"西医/心理建议"}</h3>
            {analysisResult.westernAdvice.map((item) => (
              <div key={item} className="advice-item">
                {item}
              </div>
            ))}
          </aside>
        </>
      )}

      <div className="mind-stage-overlay">
        {stage === "assessment" && (
          <div className="mind-stage-card">
            <h2>{"第一步：注册评估"}</h2>
            <p>{"请先完成一轮简短评估，我们会先判断当前波动层级。"}</p>
            <div className="survey-list">
              {ASSESSMENT_QUESTIONS.map((question, idx) => (
                <label key={question} className="survey-item">
                  <span>{question}</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={assessmentAnswers[idx]}
                    onChange={(e) =>
                      setAssessmentAnswers((prev) => prev.map((value, i) => (i === idx ? Number(e.target.value) : value)))
                    }
                  />
                  <b>{assessmentAnswers[idx]}</b>
                </label>
              ))}
            </div>
            <button type="button" onClick={submitAssessment} disabled={assessmentLoading}>
              {assessmentLoading ? "评估中..." : "提交评估"}
            </button>
          </div>
        )}

        {stage === "state_input" && (
          <div className="mind-stage-card">
            <h2>{"第二步：输入当前状态"}</h2>
            <p>
              {assessmentResult
                ? `当前评估：${levelLabel(assessmentResult.level)} (${assessmentResult.score}分)`
                : "请描述你现在的感受，系统会给出三态分类与双轨建议。"}
            </p>
            <textarea
              value={stateText}
              onChange={(e) => setStateText(e.target.value)}
              placeholder={"例如：今天睡够了，但脑子还是很乱，不想说话"}
            />
            <div className="state-grid">
              <label>
                {"睡眠时长"}
                <input type="number" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} min={0} max={24} />
              </label>
              <label>
                {"疲劳感(1-5)"}
                <input
                  type="number"
                  value={fatigueLevel}
                  min={1}
                  max={5}
                  onChange={(e) => setFatigueLevel(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                />
              </label>
              <label>
                {"社交意愿(1-5)"}
                <input
                  type="number"
                  value={socialWillingness}
                  min={1}
                  max={5}
                  onChange={(e) => setSocialWillingness(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
            <button type="button" onClick={submitStateAnalyze} disabled={analysisLoading}>
              {analysisLoading ? "分析中..." : "生成调理方案"}
            </button>
          </div>
        )}

        {flowError && <div className="message-box">{flowError}</div>}
      </div>

      {stage === "result" && (
        <ChatDock
          onLogout={onLogout}
          chatEnabled={stage === "result"}
          analysisResult={analysisResult}
          onRequestReassess={restartFlow}
          levelLabel={levelLabel}
          stateTypeLabel={stateTypeLabel}
        />
      )}
    </div>
  );
}
