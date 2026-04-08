import { FormEvent } from "react";
import { InputBarProps } from "./types";

export function InputBar({
  value,
  inputRef,
  onChange,
  onSubmit,
  onToggleVoiceInput,
  onToggleVoiceOutput,
  voiceOutputEnabled,
  voiceInputActive,
  inputDisabled,
  controlsDisabled,
  submitDisabled,
  loading,
  compact
}: InputBarProps): JSX.Element {
  const onFormSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (submitDisabled) return;
    onSubmit();
  };

  return (
    <form className={`mira-inputbar ${compact ? "compact" : ""}`} onSubmit={onFormSubmit}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="和小镜聊聊现在发生了什么..."
        disabled={inputDisabled}
      />
      <button
        type="button"
        className={`mira-input-icon ${voiceInputActive ? "active" : ""}`}
        onClick={onToggleVoiceInput}
        disabled={controlsDisabled}
        title="语音输入"
      >
        {voiceInputActive ? "◉" : "🎤"}
      </button>
      <button
        type="button"
        className={`mira-input-icon ${voiceOutputEnabled ? "active" : ""}`}
        onClick={() => onToggleVoiceOutput(!voiceOutputEnabled)}
        title="语音播报"
      >
        {voiceOutputEnabled ? "🔊" : "🔈"}
      </button>
      <button type="submit" className="mira-send" disabled={submitDisabled || !value.trim()}>
        {loading ? "发送中..." : "发送"}
      </button>
    </form>
  );
}
