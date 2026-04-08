import { RefObject } from "react";
import { ChatMessage, ChatSession } from "../../lib/api";

export interface SixDimAdvice {
  body: string;
  emotion: string;
  cognition: string;
  behavior: string;
  relation: string;
  environment: string;
}

export interface AnalysisSummary {
  stateTypeLabel: string;
  levelLabel: string;
  emotionTags: string[];
  riskNotice: string | null;
  microTasks: string[];
  adviceUpdating: boolean;
  sixDimAdvice: SixDimAdvice | null;
}

export interface SessionItem extends ChatSession {
  preview: string;
}

export interface SidebarProps {
  search: string;
  onSearch: (value: string) => void;
  sessions: SessionItem[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onRequestReassess: () => void;
  onLogout: () => void;
  creating: boolean;
  deletingSessionId: string;
}

export interface ChatAreaProps {
  messages: ChatMessage[];
  analysisSummary: AnalysisSummary;
  assessmentLabel: string;
  inputValue: string;
  inputRef: RefObject<HTMLInputElement>;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onToggleVoiceInput: () => void;
  onToggleVoiceOutput: (enabled: boolean) => void;
  voiceOutputEnabled: boolean;
  voiceInputActive: boolean;
  inputDisabled: boolean;
  controlsDisabled: boolean;
  submitDisabled: boolean;
  loading: boolean;
}

export interface InputBarProps {
  value: string;
  inputRef: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onToggleVoiceInput: () => void;
  onToggleVoiceOutput: (enabled: boolean) => void;
  voiceOutputEnabled: boolean;
  voiceInputActive: boolean;
  inputDisabled: boolean;
  controlsDisabled: boolean;
  submitDisabled: boolean;
  loading: boolean;
  compact?: boolean;
}

export interface EmotionPanelProps {
  sixDimAdvice: SixDimAdvice | null;
  microTasks: string[];
  checkedTaskIds: Set<string>;
  onToggleTask: (task: string) => void;
}
