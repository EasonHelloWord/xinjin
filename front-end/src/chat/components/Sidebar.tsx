import { SessionItem, SidebarProps } from "./types";

const formatSessionTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const sessionGroupLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.floor((today - target) / 86_400_000);
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays <= 7) return "近7天";
  return "更早";
};

const groupedSessions = (sessions: SessionItem[]): Array<{ label: string; items: SessionItem[] }> => {
  const groups = new Map<string, SessionItem[]>();
  sessions.forEach((item) => {
    const label = sessionGroupLabel(item.created_at);
    const existing = groups.get(label) ?? [];
    existing.push(item);
    groups.set(label, existing);
  });

  const order = ["今天", "昨天", "近7天", "更早"];
  return order
    .map((label) => ({ label, items: groups.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
};

export function Sidebar({
  search,
  onSearch,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
  onRequestReassess,
  onLogout,
  creating,
  deletingSessionId
}: SidebarProps): JSX.Element {
  const filtered = sessions.filter((item) => {
    if (!search.trim()) return true;
    const keyword = search.trim().toLowerCase();
    return item.title.toLowerCase().includes(keyword) || item.preview.toLowerCase().includes(keyword);
  });

  return (
    <aside className="mira-sidebar">
      <div className="mira-sidebar-head">
        <div className="mira-brand">{"心境 Mira"}</div>
        <input
          className="mira-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索会话"
        />
        <button type="button" className="mira-new-chat" onClick={onCreateSession} disabled={creating}>
          {creating ? "创建中..." : "＋ 新建对话"}
        </button>
      </div>

      <div className="mira-session-groups">
        {groupedSessions(filtered).map((group) => (
          <section key={group.label} className="mira-session-group">
            <h4>{group.label}</h4>
            {group.items.map((session) => (
              <div key={session.id} className="mira-session-row">
                <button
                  type="button"
                  className={`mira-session-item ${session.id === activeSessionId ? "active" : ""}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="mira-session-title">{session.title || "未命名会话"}</div>
                  <div className="mira-session-meta">{`${session.preview || "等待开始对话"} · ${formatSessionTime(session.created_at)}`}</div>
                </button>
                <button
                  type="button"
                  className="mira-session-delete"
                  onClick={() => onDeleteSession(session.id)}
                  disabled={creating || deletingSessionId === session.id}
                  aria-label={`删除会话 ${session.title || "未命名会话"}`}
                  title="删除会话"
                >
                  {deletingSessionId === session.id ? "…" : "×"}
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="mira-sidebar-foot">
        <button type="button" onClick={onRequestReassess} className="mira-side-action">
          重新评估
        </button>
        <button type="button" onClick={onLogout} className="mira-side-action">
          退出登录
        </button>
      </div>
    </aside>
  );
}
