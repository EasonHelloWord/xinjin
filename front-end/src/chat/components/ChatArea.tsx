import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InputBar } from "./InputBar";
import { ChatAreaProps } from "./types";

type AnimatedSegment = {
  id: string;
  text: string;
};

function MarkdownMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="mira-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function StreamingAssistantText({ text }: { text: string }): JSX.Element {
  const [settledText, setSettledText] = useState(text);
  const [pendingSegments, setPendingSegments] = useState<AnimatedSegment[]>([]);
  const latestFullTextRef = useRef(text);
  const timeoutIdsRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const previousFullText = latestFullTextRef.current;
    if (text === previousFullText) {
      return;
    }

    if (!text.startsWith(previousFullText)) {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
      latestFullTextRef.current = text;
      setPendingSegments([]);
      setSettledText(text);
      return;
    }

    const appendedText = text.slice(previousFullText.length);
    if (!appendedText) {
      latestFullTextRef.current = text;
      return;
    }

    latestFullTextRef.current = text;
    const segmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPendingSegments((prev) => [...prev, { id: segmentId, text: appendedText }]);

    const timeoutId = window.setTimeout(() => {
      setSettledText((prev) => prev + appendedText);
      setPendingSegments((prev) => prev.filter((item) => item.id !== segmentId));
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
    }, 260);

    timeoutIdsRef.current.push(timeoutId);
  }, [text]);

  const pendingText = pendingSegments.map((segment) => segment.text).join("");

  return (
    <MarkdownMessage text={settledText + pendingText} />
  );
}

export function ChatArea({
  messages,
  analysisSummary,
  assessmentLabel,
  inputValue,
  inputRef,
  onInputChange,
  onSubmit,
  thinkingEnabled,
  onToggleThinking,
  onToggleVoiceInput,
  onToggleVoiceOutput,
  voiceOutputEnabled,
  voiceInputActive,
  inputDisabled,
  controlsDisabled,
  submitDisabled,
  loading
}: ChatAreaProps): JSX.Element {
  const [panelExpanded, setPanelExpanded] = useState(true);
  const messageListRef = useRef<HTMLElement | null>(null);
  const thumbDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const [scrollbarState, setScrollbarState] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0
  });
  const hasMessages = messages.length > 0;

  const tagList = useMemo(() => analysisSummary.emotionTags.slice(0, 6), [analysisSummary.emotionTags]);

  const syncScrollbar = (): void => {
    const node = messageListRef.current;
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

    setScrollbarState({
      visible: true,
      thumbHeight,
      thumbTop
    });
  };

  useEffect(() => {
    if (!loading || !hasMessages) return;
    const node = messageListRef.current;
    if (!node) return;
    const rafId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      syncScrollbar();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, loading, hasMessages]);

  useEffect(() => {
    const node = messageListRef.current;
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
  }, [hasMessages]);

  useEffect(() => {
    syncScrollbar();
  }, [messages]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const node = messageListRef.current;
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
    const node = messageListRef.current;
    if (!node || !scrollbarState.visible) return;
    const track = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - track.top - scrollbarState.thumbHeight / 2;
    const maxThumbTop = Math.max(1, track.height - scrollbarState.thumbHeight);
    const ratio = Math.max(0, Math.min(1, clickY / maxThumbTop));
    node.scrollTop = ratio * Math.max(0, node.scrollHeight - node.clientHeight);
    syncScrollbar();
  };

  const onScrollbarThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const node = messageListRef.current;
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    thumbDragRef.current = {
      startY: event.clientY,
      startScrollTop: node.scrollTop
    };
  };

  if (!hasMessages) {
    return (
      <main className="mira-chat-main empty">
        <div className="mira-ambient-orb" aria-hidden />
        <div className="mira-empty-content">
          <h1>Hi，和小镜说点什么吧</h1>
          <p>你不需要整理得很完美，想到什么就说什么。</p>
          <InputBar
            value={inputValue}
            inputRef={inputRef}
            onChange={onInputChange}
            onSubmit={onSubmit}
            thinkingEnabled={thinkingEnabled}
            onToggleThinking={onToggleThinking}
            onToggleVoiceInput={onToggleVoiceInput}
            onToggleVoiceOutput={onToggleVoiceOutput}
            voiceOutputEnabled={voiceOutputEnabled}
            voiceInputActive={voiceInputActive}
            inputDisabled={inputDisabled}
            controlsDisabled={controlsDisabled}
            submitDisabled={submitDisabled}
            loading={loading}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="mira-chat-main">
      <section className="mira-eval-bar">
        <button type="button" className="mira-eval-toggle" onClick={() => setPanelExpanded((v) => !v)}>
          <span className="mira-eval-headline">{`◌ ${analysisSummary.stateTypeLabel} · ${analysisSummary.levelLabel}`}</span>
          <span>{panelExpanded ? "收起" : "展开"}</span>
        </button>
        {panelExpanded && (
          <div className="mira-eval-detail">
            {assessmentLabel && <p>{`评估：${assessmentLabel}`}</p>}
            <div className="mira-tag-row">
              {tagList.map((tag) => (
                <span key={tag} className="mira-tag">
                  {tag}
                </span>
              ))}
            </div>
            {analysisSummary.adviceUpdating && <div className="mira-light-hint">正在根据最新对话更新建议...</div>}
            {analysisSummary.riskNotice && <div className="mira-risk-hint">{`⚠ ${analysisSummary.riskNotice}`}</div>}
          </div>
        )}
      </section>

      <div className="mira-chat-shell">
        <div className="mira-message-list-wrap">
          <section ref={messageListRef} className="mira-message-list" aria-live="polite">
            {messages.map((msg) => (
              <article key={msg.id} className={`mira-msg ${msg.role === "user" ? "user" : "assistant"}`}>
                <div className="mira-msg-bubble">
                  {msg.role === "assistant" ? (
                    <StreamingAssistantText text={msg.content || "..."} />
                  ) : (
                    <MarkdownMessage text={msg.content || "..."} />
                  )}
                </div>
              </article>
            ))}
          </section>
          {scrollbarState.visible && (
            <div className="mira-message-scrollbar" onPointerDown={onScrollbarTrackPointerDown} aria-hidden>
              <div
                className="mira-message-scrollbar__thumb"
                style={{
                  height: `${scrollbarState.thumbHeight}px`,
                  transform: `translateY(${scrollbarState.thumbTop}px)`
                }}
                onPointerDown={onScrollbarThumbPointerDown}
              />
            </div>
          )}
        </div>

        <div className="mira-chat-input-dock">
          <InputBar
            compact
            value={inputValue}
            inputRef={inputRef}
            onChange={onInputChange}
            onSubmit={onSubmit}
            thinkingEnabled={thinkingEnabled}
            onToggleThinking={onToggleThinking}
            onToggleVoiceInput={onToggleVoiceInput}
            onToggleVoiceOutput={onToggleVoiceOutput}
            voiceOutputEnabled={voiceOutputEnabled}
            voiceInputActive={voiceInputActive}
            inputDisabled={inputDisabled}
            controlsDisabled={controlsDisabled}
            submitDisabled={submitDisabled}
            loading={loading}
          />
        </div>
      </div>
    </main>
  );
}
