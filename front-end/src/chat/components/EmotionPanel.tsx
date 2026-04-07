import { EmotionPanelProps } from "./types";

const SIX_DIM_ITEMS = [
  { key: "body", icon: "◌", title: "身体" },
  { key: "emotion", icon: "◎", title: "情绪" },
  { key: "cognition", icon: "◇", title: "认知" },
  { key: "behavior", icon: "↺", title: "行为" },
  { key: "relation", icon: "∞", title: "关系" },
  { key: "environment", icon: "⌂", title: "环境" }
] as const;

export function EmotionPanel({ sixDimAdvice, microTasks, checkedTaskIds, onToggleTask }: EmotionPanelProps): JSX.Element {
  return (
    <aside className="mira-emotion-panel">
      <section className="mira-panel-card">
        <header>
          <h3>六维调节</h3>
          <span>今天给自己一点温和节奏</span>
        </header>
        <div className="mira-dim-grid">
          {SIX_DIM_ITEMS.map((item) => (
            <article key={item.key} className="mira-dim-item">
              <div className="mira-dim-title">{`${item.icon} ${item.title}`}</div>
              <p>{sixDimAdvice?.[item.key] || "先深呼吸三次，允许自己慢一点。"}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mira-panel-card">
        <header>
          <h3>今日微任务</h3>
          <span>完成一个也算前进</span>
        </header>
        <div className="mira-task-list">
          {microTasks.map((task) => {
            const checked = checkedTaskIds.has(task);
            return (
              <label className={`mira-task-item ${checked ? "checked" : ""}`} key={task}>
                <input type="checkbox" checked={checked} onChange={() => onToggleTask(task)} />
                <span>{task}</span>
              </label>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
