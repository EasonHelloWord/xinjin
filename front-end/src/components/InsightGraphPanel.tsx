import { AnalysisResult, AssessmentResult, InsightData, StateType } from "../lib/api";

interface InsightGraphPanelProps {
  assessmentResult: AssessmentResult | null;
  analysisResult: AnalysisResult | null;
  insightData: InsightData | null;
  checkedTaskIds?: Set<string>;
  onToggleTask?: (task: string) => void;
  mode?: "panel" | "dashboard";
}

const SIX_DIM_ITEMS = [
  { key: "body", icon: "◌", title: "身体" },
  { key: "emotion", icon: "◎", title: "情绪" },
  { key: "cognition", icon: "◇", title: "认知" },
  { key: "behavior", icon: "↺", title: "行为" },
  { key: "relation", icon: "∞", title: "关系" },
  { key: "environment", icon: "⌂", title: "环境" }
] as const;

const DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

const STATE_COLORS: Record<StateType, string> = {
  sensory_overload: "#d99a78",
  emotional_block: "#426b68",
  mixed_fluctuation: "#c8b9a4",
  stable_normal: "#8eb5a1"
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const levelLabel = (level: AssessmentResult["level"] | AnalysisResult["level"] | undefined): string => {
  if (level === "healthy") return "健康";
  if (level === "mild") return "轻度波动";
  if (level === "moderate") return "中度波动";
  if (level === "severe") return "重度风险";
  return "未评估";
};

const stateTypeLabel = (stateType: StateType | undefined): string => {
  if (stateType === "sensory_overload") return "感官过载";
  if (stateType === "emotional_block") return "情感屏蔽";
  if (stateType === "stable_normal") return "稳定恢复";
  if (stateType === "mixed_fluctuation") return "波动混合";
  return "待识别";
};

const trendPath = (values: Array<number | null>): string => {
  const valid = values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => typeof point.value === "number");
  if (valid.length === 0) return "";
  const denominator = Math.max(1, values.length - 1);
  return valid
    .map((point, pathIndex) => {
      const x = 8 + (point.index / denominator) * 184;
      const y = 92 - ((point.value - 35) / 65) * 72;
      return `${pathIndex === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
};

const heatColor = (load: number | null | undefined): string => {
  if (typeof load !== "number") return "#e7eee9";
  if (load < 28) return "#dcece4";
  if (load < 44) return "#b9d8bd";
  if (load < 60) return "#cbd79e";
  if (load < 76) return "#e5c07c";
  return "#e59a64";
};

const donutSegments = (items: Array<{ label: string; value: number; color: string }>) => {
  let offset = 25;
  return items.map((item) => {
    const segment = { ...item, offset };
    offset -= item.value;
    return segment;
  });
};

export function InsightGraphPanel({
  assessmentResult,
  analysisResult,
  insightData,
  checkedTaskIds = new Set<string>(),
  onToggleTask,
  mode = "panel"
}: InsightGraphPanelProps): JSX.Element {
  const score = clamp(assessmentResult?.score ?? 0, 0, 100);
  const resolvedLevelLabel = levelLabel(analysisResult?.level ?? assessmentResult?.level);
  const resolvedStateTypeLabel = stateTypeLabel(analysisResult?.stateType);
  const microTasks = analysisResult?.microTasks ?? [];
  const completedCount = microTasks.filter((task) => checkedTaskIds.has(task)).length;
  const sourceCounts = insightData?.sourceCounts ?? { assessments: 0, analyses: 0, microTaskEvents: 0 };
  const sectionAverages = insightData?.sectionAverages ?? {
    emotion: null,
    selfAndRelation: null,
    bodyAndVitality: null,
    meaningAndHope: null
  };
  const sectionValues = [sectionAverages.emotion, sectionAverages.selfAndRelation, sectionAverages.bodyAndVitality, sectionAverages.meaningAndHope].filter(
    (value): value is number => typeof value === "number"
  );
  const stability = sourceCounts.analyses > 0 ? clamp(100 - Math.round((insightData?.heatmap ?? []).reduce((sum, item) => sum + (item.loadAverage ?? 0), 0) / Math.max(1, (insightData?.heatmap ?? []).filter((item) => item.loadAverage !== null).length)), 0, 100) : null;
  const recovery = sectionValues.length ? Math.round(sectionValues.reduce((sum, value) => sum + value, 0) / sectionValues.length) : null;
  const trendValues = insightData?.healthTrend.map((item) => item.score) ?? [];
  const path = trendPath(trendValues);
  const distribution = (insightData?.stateDistribution ?? [])
    .filter((item) => item.count > 0 || item.percentage > 0)
    .map((item) => ({ label: stateTypeLabel(item.stateType), value: item.percentage, color: STATE_COLORS[item.stateType] }));
  const heatmap = insightData?.heatmap ?? [];
  const interventions = insightData?.interventionEffect ?? [];
  const sixDimAdvice = analysisResult?.sixDimAdvice ?? null;
  const emotionTags = analysisResult?.emotionTags ?? [];

  return (
    <aside className={"mira-insight-panel " + (mode === "dashboard" ? "insight-dashboard-grid" : "mira-emotion-panel")}>
      <section className="mira-panel-card insight-hero">
        <header>
          <h3>个人图谱</h3>
          <span>{resolvedLevelLabel + " · " + resolvedStateTypeLabel}</span>
        </header>
        <div className="insight-score-row">
          <strong>{assessmentResult ? score : "--"}</strong>
          <div>
            <span>健康分</span>
            <em>{stability === null ? "稳定度暂无" : `稳定度 ${stability}%`}</em>
          </div>
        </div>
        <div className="insight-metrics">
          <span>{recovery === null ? "恢复力暂无" : `恢复力 ${recovery}%`}</span>
          <span>{`微任务 ${completedCount}/${microTasks.length || 0}`}</span>
        </div>
      </section>

      <section className="mira-panel-card chart-card trend-card">
        <header>
          <h3>健康分数趋势</h3>
          <span>{`真实评估 ${sourceCounts.assessments} 条`}</span>
        </header>
        <svg className="trend-chart" viewBox="0 0 200 108" role="img" aria-label="健康分数趋势图">
          {[35, 50, 65, 80, 95].map((line) => (
            <line key={line} x1="8" x2="192" y1={92 - ((line - 35) / 65) * 72} y2={92 - ((line - 35) / 65) * 72} />
          ))}
          {path && <path className="trend-line" d={path} />}
          {trendValues.map((value, index) => {
            if (typeof value !== "number") return null;
            const x = 8 + (index / Math.max(1, trendValues.length - 1)) * 184;
            const y = 92 - ((value - 35) / 65) * 72;
            return <circle key={`${value}-${index}`} cx={x} cy={y} r="2.6" />;
          })}
        </svg>
        <div className="chart-axis-labels"><span>{insightData?.range.startDate ?? "开始"}</span><span>{insightData?.range.endDate ?? "结束"}</span></div>
      </section>

      <section className="mira-panel-card chart-card donut-card">
        <header>
          <h3>三态类型分布</h3>
          <span>{`真实分析 ${sourceCounts.analyses} 条`}</span>
        </header>
        <div className="donut-wrap">
          <div className="donut-figure">
            <svg className="donut-chart" viewBox="0 0 42 42" role="img" aria-label="三态类型分布图">
              {donutSegments(distribution).map((item) => (
                <circle
                  key={item.label}
                  cx="21"
                  cy="21"
                  r="15.9"
                  fill="transparent"
                  stroke={item.color}
                  strokeWidth="7"
                  strokeDasharray={`${item.value} ${100 - item.value}`}
                  strokeDashoffset={item.offset}
                />
              ))}
            </svg>
            <div className="donut-center">
              <strong>{sourceCounts.analyses}</strong>
              <span>分析</span>
            </div>
          </div>
          <div className="donut-legend">
            {distribution.length ? distribution.map((item) => (
              <span key={item.label}><i style={{ background: item.color }} />{`${item.label} ${item.value}%`}</span>
            )) : <span>暂无状态分析</span>}
          </div>
        </div>
      </section>

      <section className="mira-panel-card chart-card heatmap-card">
        <header>
          <h3>状态热力图</h3>
          <span>真实对话分析时段</span>
        </header>
        <div className="heatmap-grid">
          <div className="heatmap-row heatmap-head">
            <span className="heatmap-day">时段</span>
            {HOURS.map((hour) => <span key={hour} className="heatmap-axis">{String(hour).padStart(2, "0")}</span>)}
          </div>
          {DAYS.map((day, dayOfWeek) => (
            <div className="heatmap-row" key={day}>
              <span className="heatmap-day">{day}</span>
              {HOURS.map((hour) => {
                const cell = heatmap.find((item) => item.dayOfWeek === dayOfWeek && item.hour === hour);
                const load = cell?.loadAverage;
                return (
                  <i
                    key={`${dayOfWeek}-${hour}`}
                    style={{ background: heatColor(load), opacity: typeof load === "number" ? clamp(0.58 + load / 180, 0.58, 1) : 1 }}
                    title={`${day} ${hour}时 ${cell?.count ?? 0}条${typeof load === "number" ? `，负荷${load}%` : ""}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="mira-panel-card chart-card section-card">
        <header>
          <h3>四维资源</h3>
          <span>真实评估均值</span>
        </header>
        <div className="section-bars">
          {[
            ["情绪", sectionAverages.emotion],
            ["自我关系", sectionAverages.selfAndRelation],
            ["身体活力", sectionAverages.bodyAndVitality],
            ["意义希望", sectionAverages.meaningAndHope]
          ].map(([label, value]) => {
            const percent = typeof value === "number" ? value : 0;
            return (
              <div className="section-bar" key={label as string}>
                <span>{label}</span>
                <i><b style={{ width: `${percent}%` }} /></i>
                <em>{typeof value === "number" ? `${value}%` : "暂无"}</em>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mira-panel-card chart-card intervention-card">
        <header>
          <h3>干预效果追踪</h3>
          <span>{`完成记录 ${sourceCounts.microTaskEvents} 条`}</span>
        </header>
        <div className="intervention-status-list">
          {interventions.length ? interventions.map((item) => {
            const completed = item.completedCount > 0;
            return (
              <div className={`intervention-status ${completed ? "done" : "pending"}`} key={item.label}>
                <span title={item.label}>{item.label}</span>
                <em>{completed ? "已完成" : "未完成"}</em>
              </div>
            );
          }) : <div className="insight-empty-line">暂无微任务完成记录</div>}
        </div>
      </section>

      <section className="mira-panel-card six-dim compact-six-dim">
        <header>
          <h3>六维调节</h3>
          <span>最近一次真实分析</span>
        </header>
        <div className="mira-dim-grid">
          {SIX_DIM_ITEMS.map((item) => (
            <article key={item.key} className="mira-dim-item">
              <div className="mira-dim-title">{`${item.icon} ${item.title}`}</div>
              <p>{sixDimAdvice?.[item.key] || "暂无建议。完成一次状态分析后会在这里显示。"}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mira-panel-card micro-tasks">
        <header>
          <h3>今日微任务</h3>
          <span>{emotionTags.slice(0, 3).join(" · ") || "来自最近一次分析"}</span>
        </header>
        <div className="mira-task-list">
          {microTasks.map((task) => {
            const checked = checkedTaskIds.has(task);
            return (
              <label className={`mira-task-item ${checked ? "checked" : ""}`} key={task}>
                <input type="checkbox" checked={checked} onChange={() => onToggleTask?.(task)} />
                <span>{task}</span>
              </label>
            );
          })}
          {microTasks.length === 0 && <div className="insight-empty-line">暂无微任务</div>}
        </div>
      </section>
    </aside>
  );
}
