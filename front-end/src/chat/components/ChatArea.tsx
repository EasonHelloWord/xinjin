import { useMemo, useState } from "react";
import { InputBar } from "./InputBar";
import { ChatAreaProps } from "./types";

export function ChatArea({
  messages,
  analysisSummary,
  assessmentLabel,
  inputValue,
  onInputChange,
  onSubmit,
  onToggleVoiceInput,
  onToggleVoiceOutput,
  voiceOutputEnabled,
  voiceInputActive,
  disabled,
  loading
}: ChatAreaProps): JSX.Element {
  const [panelExpanded, setPanelExpanded] = useState(true);
  const hasMessages = messages.length > 0;

  const tagList = useMemo(() => analysisSummary.emotionTags.slice(0, 6), [analysisSummary.emotionTags]);

  if (!hasMessages) {
    return (
      <main className="mira-chat-main empty">
        <div className="mira-ambient-orb" aria-hidden />
        <div className="mira-empty-content">
          <h1>Hi，和小镜说点什么吧</h1>
          <p>你不需要整理得很完美，想到什么就说什么。</p>
          <InputBar
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSubmit}
            onToggleVoiceInput={onToggleVoiceInput}
            onToggleVoiceOutput={onToggleVoiceOutput}
            voiceOutputEnabled={voiceOutputEnabled}
            voiceInputActive={voiceInputActive}
            disabled={disabled}
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
        <section className="mira-message-list" aria-live="polite">
          {messages.map((msg) => (
            <article key={msg.id} className={`mira-msg ${msg.role === "user" ? "user" : "assistant"}`}>
              <div className="mira-msg-bubble">{msg.content || "..."}</div>
            </article>
          ))}
        </section>

        <div className="mira-chat-input-dock">
          <InputBar
            compact
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSubmit}
            onToggleVoiceInput={onToggleVoiceInput}
            onToggleVoiceOutput={onToggleVoiceOutput}
            voiceOutputEnabled={voiceOutputEnabled}
            voiceInputActive={voiceInputActive}
            disabled={disabled}
            loading={loading}
          />
        </div>
      </div>
    </main>
  );
}
