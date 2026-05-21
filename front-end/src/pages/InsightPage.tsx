import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { InsightGraphPanel } from "../components/InsightGraphPanel";
import { AnalysisResult, api, AssessmentResult, InsightData, ProfileTimeline } from "../lib/api";

interface InsightPageProps {
  onLogout: () => void;
}

const dailyTaskCheckKey = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `xinjin.daily-microtasks.checked.${y}-${m}-${d}`;
};

const formatTime = (timestamp?: number): string => {
  if (!timestamp) return "暂无记录";
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const levelText = (level?: AssessmentResult["level"] | AnalysisResult["level"]): string => {
  if (level === "healthy") return "健康";
  if (level === "mild") return "轻度波动";
  if (level === "moderate") return "中度波动";
  if (level === "severe") return "重度风险";
  return "待评估";
};

export function InsightPage({ onLogout }: InsightPageProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [timeline, setTimeline] = useState<ProfileTimeline | null>(null);
  const [insightData, setInsightData] = useState<InsightData | null>(null);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        setError(null);
        const [summary, profileTimeline, insights] = await Promise.all([
          api.getProfileSummary(),
          api.getProfileTimeline(),
          api.getProfileInsights(30)
        ]);
        setAssessmentResult(summary.latestAssessment);
        setAnalysisResult(summary.latestAnalysis);
        setTimeline(profileTimeline);
        setInsightData(insights);
      } catch (err) {
        setError((err as Error).message || "读取图谱数据失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const latestCompleted = new Set<string>();
    const currentTasks = new Set(analysisResult?.microTasks ?? []);
    for (const event of insightData?.microTaskEvents ?? []) {
      if (!event.completed) continue;
      if (currentTasks.size > 0 && !currentTasks.has(event.task)) continue;
      latestCompleted.add(event.task);
    }
    setCheckedTaskIds(latestCompleted);
  }, [analysisResult, insightData]);

  const timelineStats = useMemo(() => {
    const assessments = timeline?.assessments ?? [];
    const analyses = timeline?.analyses ?? [];
    const scores = assessments.map((item) => item.score).filter((score) => Number.isFinite(score));
    const best = scores.length ? Math.max(...scores) : assessmentResult?.score;
    const first = scores[0];
    const latest = scores[scores.length - 1] ?? assessmentResult?.score;
    const delta = Number.isFinite(first) && Number.isFinite(latest) ? Math.round((latest ?? 0) - (first ?? 0)) : 0;
    const tags = analyses.flatMap((item) => item.emotionTags ?? []).slice(-8);
    return { assessmentCount: assessments.length, analysisCount: analyses.length, best, delta, tags };
  }, [assessmentResult?.score, timeline]);

  const onToggleTask = (task: string): void => {
    setCheckedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      window.localStorage.setItem(dailyTaskCheckKey(), JSON.stringify(Array.from(next)));
      const completed = next.has(task);
      void api.toggleMicroTask(task, completed).then(() => api.getProfileInsights(30).then(setInsightData)).catch(() => undefined);
      return next;
    });
  };

  return (
    <main className="insight-page">
      <header className="insight-page-header">
        <div>
          <span>心境 · 照见自身</span>
          <h1>数据可视化图谱</h1>
          <p>把评估、对话分析和微任务沉淀为可观察的健康趋势、状态类型、时段负荷与干预反馈。</p>
        </div>
        <nav>
          <Link to="/mind">返回对话</Link>
          <button type="button" onClick={onLogout}>退出登录</button>
        </nav>
      </header>

      {loading && <section className="insight-empty">正在读取你的图谱数据...</section>}
      {error && <section className="insight-empty">{error}</section>}
      {!loading && !error && !assessmentResult && (
        <section className="insight-empty">
          <h2>还没有评估数据</h2>
          <p>完成一次注册评估后，这里会生成完整的数据图谱。</p>
          <Link to="/mind">去评估</Link>
        </section>
      )}

      {!loading && !error && assessmentResult && (
        <>
          <section className="insight-topline">
            <article>
              <span>最新健康分</span>
              <strong>{assessmentResult.score}</strong>
              <em>{levelText(analysisResult?.level ?? assessmentResult.level)}</em>
            </article>
            <article>
              <span>最高记录</span>
              <strong>{timelineStats.best ?? assessmentResult.score}</strong>
              <em>{`累计评估 ${timelineStats.assessmentCount || 1} 次`}</em>
            </article>
            <article>
              <span>趋势变化</span>
              <strong>{timelineStats.delta > 0 ? `+${timelineStats.delta}` : timelineStats.delta}</strong>
              <em>相对首条记录</em>
            </article>
            <article>
              <span>最近分析</span>
              <strong>{timelineStats.analysisCount || (analysisResult ? 1 : 0)}</strong>
              <em>{formatTime(analysisResult?.createdAt ?? assessmentResult.createdAt)}</em>
            </article>
          </section>

          <InsightGraphPanel
            mode="dashboard"
            assessmentResult={assessmentResult}
            analysisResult={analysisResult}
            insightData={insightData}
            checkedTaskIds={checkedTaskIds}
            onToggleTask={onToggleTask}
          />

          <section className="insight-context-band">
            <article>
              <h2>近期情绪标签</h2>
              <div className="insight-tag-cloud">
                {(timelineStats.tags.length ? timelineStats.tags : analysisResult?.emotionTags ?? ["稳定观察", "待积累"]).map((tag, index) => (
                  <span key={`${tag}-${index}`}>{tag}</span>
                ))}
              </div>
            </article>
            <article>
              <h2>状态摘要</h2>
              <p>{analysisResult?.summary || "暂无状态摘要。完成一次对话分析后，这里会补充更细的状态解释。"}</p>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
