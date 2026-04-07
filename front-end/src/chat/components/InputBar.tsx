import { FormEvent } from "react";
import { InputBarProps } from "./types";

export function InputBar({
  value,
  onChange,
  onSubmit,
  onToggleVoiceInput,
  onToggleVoiceOutput,
  voiceOutputEnabled,
  voiceInputActive,
  disabled,
  loading,
  compact
}: InputBarProps): JSX.Element {
  const onFormSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className={`mira-inputbar ${compact ? "compact" : ""}`} onSubmit={onFormSubmit}>
      <button type="button" className="mira-input-icon" title="附件（即将支持）" disabled>
        ⊕
      </button>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="和小镜聊聊现在发生了什么..."
        disabled={disabled}
      />
      <button
        type="button"
        className={`mira-input-icon ${voiceInputActive ? "active" : ""}`}
        onClick={onToggleVoiceInput}
        disabled={disabled}
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
      <button type="submit" className="mira-send" disabled={disabled || !value.trim()}>
        {loading ? "发送中..." : "发送"}
      </button>
    </form>
  );
}
