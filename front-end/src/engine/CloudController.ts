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

interface Transition {
  start: StateVisualInput;
  end: StateVisualInput;
  duration: number;
  elapsed: number;
}

export interface ControllerSnapshot {
  state: StateVisualInput;
  visual: CloudVisualParams;
  interactionMode: InteractionMode;
  interactionStrength: number;
  interactionRadius: number;
  damping: number;
  paused: boolean;
  bloomEnabled: boolean;
}

type Listener = (snapshot: ControllerSnapshot) => void;

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

  setState(partial: Partial<StateVisualInput>, transitionMs = 500): void {
    const next = normalizeState(partial, this.state);
    this.startTransition(next, transitionMs);
  }

  setPreset(name: PresetName, intensity?: number, transitionMs = 700): void {
    const preset = PRESETS[name];
    const merged = {
      ...preset,
      intensity: intensity !== undefined ? Math.max(0, Math.min(1, intensity)) : preset.intensity
    };
    this.startTransition(merged, transitionMs);
  }

  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode;
    this.notify();
  }

  pause(value: boolean): void {
    this.paused = value;
    this.notify();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.notify();
  }

  toggleBloom(): void {
    this.bloomEnabled = !this.bloomEnabled;
    this.notify();
  }

  setBloomEnabled(value: boolean): void {
    this.bloomEnabled = value;
    this.notify();
  }

  getBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  getState(): StateVisualInput {
    return { ...this.state };
  }

  getInteractionMode(): InteractionMode {
    return this.interactionMode;
  }

  onSnapshot(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

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

  private notify(): void {
    const snap = this.snapshot();
    this.listeners.forEach((cb) => cb(snap));
  }
}
