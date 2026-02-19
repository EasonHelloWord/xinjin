import { APP_CONFIG, SetConfigKey } from "../config";
import { PRESETS } from "../state/presets";
import {
  InteractionMode,
  PresetName,
  StateVisualInput,
  defaultState,
  normalizeState
} from "../state/types";
import { CloudVisualParams, mapStateToVisual } from "../visuals/cloud/mapping";

// 一次状态过渡的描述（从 start 插值到 end）。
interface Transition {
  start: StateVisualInput;
  end: StateVisualInput;
  duration: number;
  elapsed: number;
}

export interface ControllerSnapshot {
  // 归一化后的业务状态（0..1）
  state: StateVisualInput;
  // 映射后的可视化参数（直接给渲染层）
  visual: CloudVisualParams;
  interactionMode: InteractionMode;
  interactionStrength: number;
  interactionRadius: number;
  damping: number;
  paused: boolean;
  bloomEnabled: boolean;
}

type Listener = (snapshot: ControllerSnapshot) => void;

// 控制器：负责状态管理、过渡插值、配置更新，并向渲染层提供快照。
export class CloudController {
  private state: StateVisualInput = { ...defaultState };
  private transition: Transition | null = null;
  private interactionMode: InteractionMode = "attract";
  private paused = false;
  private bloomEnabled = APP_CONFIG.cloud.enableBloomByDefault;
  private interactionStrength = APP_CONFIG.interaction.interactionStrength;
  private interactionRadius = APP_CONFIG.interaction.interactionRadius;
  private damping = APP_CONFIG.interaction.damping;
  private pointSizeOverride: number | null = null;
  private listeners = new Set<Listener>();

  // 只更新部分状态，默认 500ms 平滑过渡。
  setState(partial: Partial<StateVisualInput>, transitionMs = 500): void {
    const next = normalizeState(partial, this.state);
    this.startTransition(next, transitionMs);
  }

  // 应用预设，可选覆盖 intensity。
  setPreset(name: PresetName, intensity?: number, transitionMs = 700): void {
    const preset = PRESETS[name];
    const merged = {
      ...preset,
      intensity: intensity !== undefined ? Math.max(0, Math.min(1, intensity)) : preset.intensity
    };
    this.startTransition(merged, transitionMs);
  }

  // 设置粒子与鼠标的交互模式。
  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode;
    this.notify();
  }

  // 显式设置暂停状态。
  pause(value: boolean): void {
    this.paused = value;
    this.notify();
  }

  // 切换暂停。
  togglePause(): void {
    this.paused = !this.paused;
    this.notify();
  }

  // 切换 Bloom。
  toggleBloom(): void {
    this.bloomEnabled = !this.bloomEnabled;
    this.notify();
  }

  // 直接设置 Bloom 开关。
  setBloomEnabled(value: boolean): void {
    this.bloomEnabled = value;
    this.notify();
  }

  // 获取当前 Bloom 开关（供引擎降级逻辑使用）。
  getBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  // 获取当前状态副本（避免外部直接改内部对象）。
  getState(): StateVisualInput {
    return { ...this.state };
  }

  // 获取当前交互模式。
  getInteractionMode(): InteractionMode {
    return this.interactionMode;
  }

  // 订阅快照变化，注册后会立即回调一次当前快照。
  onSnapshot(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  // 每帧更新：推进过渡插值并返回最新快照。
  update(deltaSec: number): ControllerSnapshot {
    if (this.transition) {
      this.transition.elapsed += deltaSec * 1000;
      const t = Math.min(1, this.transition.elapsed / this.transition.duration);
      const s = this.transition.start;
      const e = this.transition.end;
      this.state = {
        arousal: s.arousal + (e.arousal - s.arousal) * t,
        valence: s.valence + (e.valence - s.valence) * t,
        stability: s.stability + (e.stability - s.stability) * t,
        load: s.load + (e.load - s.load) * t,
        socialDrain: s.socialDrain + (e.socialDrain - s.socialDrain) * t,
        intensity: s.intensity + (e.intensity - s.intensity) * t
      };
      if (t >= 1) {
        this.transition = null;
      }
      this.notify();
    }
    return this.snapshot();
  }

  // 应用动态配置，返回是否成功（类型和值范围会做保护）。
  applyConfig(key: SetConfigKey, value: unknown): boolean {
    if (key === "interaction.interactionStrength" && typeof value === "number") {
      this.interactionStrength = Math.max(0, Math.min(3, value));
      this.notify();
      return true;
    }
    if (key === "interaction.interactionRadius" && typeof value === "number") {
      this.interactionRadius = Math.max(0.05, Math.min(3, value));
      this.notify();
      return true;
    }
    if (key === "interaction.damping" && typeof value === "number") {
      this.damping = Math.max(0.1, Math.min(0.99, value));
      this.notify();
      return true;
    }
    if (key === "cloud.enableBloomByDefault" && typeof value === "boolean") {
      this.bloomEnabled = value;
      this.notify();
      return true;
    }
    if (key === "cloud.pointSize" && typeof value === "number") {
      this.pointSizeOverride = Math.max(0.8, Math.min(6, value));
      this.notify();
      return true;
    }
    return false;
  }

  // 开始一次过渡；transitionMs<=0 时立即切换。
  private startTransition(next: StateVisualInput, transitionMs: number): void {
    if (transitionMs <= 0) {
      this.state = { ...next };
      this.transition = null;
      this.notify();
      return;
    }
    this.transition = {
      start: { ...this.state },
      end: { ...next },
      duration: transitionMs,
      elapsed: 0
    };
  }

  // 构建一个给 UI/渲染层使用的只读快照。
  private snapshot(): ControllerSnapshot {
    const visual = mapStateToVisual(this.state);
    if (this.pointSizeOverride !== null) {
      visual.pointSize = this.pointSizeOverride;
    }
    return {
      state: { ...this.state },
      visual,
      interactionMode: this.interactionMode,
      interactionStrength: this.interactionStrength,
      interactionRadius: this.interactionRadius,
      damping: this.damping,
      paused: this.paused,
      bloomEnabled: this.bloomEnabled
    };
  }

  // 通知所有订阅者。
  private notify(): void {
    const snap = this.snapshot();
    this.listeners.forEach((cb) => cb(snap));
  }
}
