import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const sessionGroupsRef = useRef<HTMLDivElement | null>(null);
  const thumbDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const [scrollbarState, setScrollbarState] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0
  });

  const filtered = sessions.filter((item) => {
    if (!search.trim()) return true;
    const keyword = search.trim().toLowerCase();
    return item.title.toLowerCase().includes(keyword) || item.preview.toLowerCase().includes(keyword);
  });

  const syncScrollbar = (): void => {
    const node = sessionGroupsRef.current;
    if (!node) return;
    const { clientHeight, scrollHeight, scrollTop } = node;
    const overflow = scrollHeight - clientHeight;
    if (overflow <= 1) {
      setScrollbarState({ visible: false, thumbHeight: 0, thumbTop: 0 });
      return;
    }

    const trackHeight = clientHeight - 12;
    const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxThumbTop <= 0 ? 0 : (scrollTop / overflow) * maxThumbTop;
    setScrollbarState({ visible: true, thumbHeight, thumbTop });
  };

  useEffect(() => {
    const node = sessionGroupsRef.current;
    if (!node) return;

    syncScrollbar();
    const onScroll = (): void => syncScrollbar();
    node.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => syncScrollbar());
    resizeObserver.observe(node);

    return () => {
      node.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    syncScrollbar();
  }, [sessions, search]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const node = sessionGroupsRef.current;
      const drag = thumbDragRef.current;
      if (!node || !drag) return;
      const { clientHeight, scrollHeight } = node;
      const trackHeight = clientHeight - 12;
      const thumbHeight = scrollbarState.thumbHeight || Math.max(30, (clientHeight / scrollHeight) * trackHeight);
      const maxThumbTop = Math.max(1, trackHeight - thumbHeight);
      const overflow = Math.max(1, scrollHeight - clientHeight);
      const deltaY = event.clientY - drag.startY;
      node.scrollTop = drag.startScrollTop + (deltaY / maxThumbTop) * overflow;
    };

    const stopDrag = (): void => {
      thumbDragRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };

    if (!thumbDragRef.current) {
      return;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, [scrollbarState.thumbHeight]);

  const onScrollbarTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const node = sessionGroupsRef.current;
    if (!node || !scrollbarState.visible) return;
    const track = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - track.top - scrollbarState.thumbHeight / 2;
    const maxThumbTop = Math.max(1, track.height - scrollbarState.thumbHeight);
    const ratio = Math.max(0, Math.min(1, clickY / maxThumbTop));
    node.scrollTop = ratio * Math.max(0, node.scrollHeight - node.clientHeight);
    syncScrollbar();
  };

  const onScrollbarThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const node = sessionGroupsRef.current;
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    thumbDragRef.current = {
      startY: event.clientY,
      startScrollTop: node.scrollTop
    };
  };

  return (
    <aside className="mira-sidebar">
      <div className="mira-sidebar-head">
        <button type="button" className="mira-brand mira-brand-button" onClick={() => navigate("/")}>
          {"心境 Mira"}
        </button>
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

      <div className="mira-session-groups-wrap">
        <div ref={sessionGroupsRef} className="mira-session-groups">
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
                    <div className="mira-session-meta">{`${session.preview || "等待 AI 回复"} · ${formatSessionTime(session.created_at)}`}</div>
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
        {scrollbarState.visible && (
          <div className="mira-session-scrollbar" onPointerDown={onScrollbarTrackPointerDown} aria-hidden>
            <div
              className="mira-session-scrollbar__thumb"
              style={{
                height: `${scrollbarState.thumbHeight}px`,
                transform: `translateY(${scrollbarState.thumbTop}px)`
              }}
              onPointerDown={onScrollbarThumbPointerDown}
            />
          </div>
        )}
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
