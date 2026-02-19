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
  maxOffset: number;
  springK: number;
  springC: number;
  deformStrength: number;
  noiseAmp: number;
  tauPointer: number;
  deadZoneRatio: number;
  responseZoneRatio: number;
  offsetCapRatio: number;
  radiusBaseRatio: number;
  radiusDensityRatio: number;
  breathAmplitude: number;
  pointerDownBoost: number;
  sphereRadius: number;
  paused: boolean;
  bloomEnabled: boolean;
}

type Listener = (snapshot: ControllerSnapshot) => void;

export class CloudController {
  private state: StateVisualInput = { ...defaultState };
  private transition: Transition | null = null;
  private interactionMode: InteractionMode = "gravity";
  private paused = false;
  private bloomEnabled = APP_CONFIG.cloud.enableBloomByDefault;
  private maxOffset = APP_CONFIG.interaction.maxOffset;
  private springK = APP_CONFIG.interaction.springK;
  private springC = APP_CONFIG.interaction.springC;
  private deformStrength = APP_CONFIG.interaction.deformStrength;
  private noiseAmp = APP_CONFIG.interaction.noiseAmp;
  private tauPointer = APP_CONFIG.interaction.tauPointer;
  private deadZoneRatio = APP_CONFIG.interaction.deadZoneRatio;
  private responseZoneRatio = APP_CONFIG.interaction.responseZoneRatio;
  private offsetCapRatio = APP_CONFIG.interaction.offsetCapRatio;
  private radiusBaseRatio = APP_CONFIG.interaction.radiusBaseRatio;
  private radiusDensityRatio = APP_CONFIG.interaction.radiusDensityRatio;
  private breathAmplitude = APP_CONFIG.interaction.breathAmplitude;
  private pointerDownBoost = APP_CONFIG.interaction.pointerDownBoost;
  private sphereRadius = APP_CONFIG.cloud.sphereRadius;
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
      if (t >= 1) this.transition = null;
      this.notify();
    }
    return this.snapshot();
  }

  applyConfig(key: SetConfigKey, value: unknown): boolean {
    if (key === "interaction.maxOffset" && typeof value === "number") {
      this.maxOffset = Math.max(0.1, Math.min(2, value));
      this.notify();
      return true;
    }
    if (key === "interaction.springK" && typeof value === "number") {
      this.springK = Math.max(1, Math.min(120, value));
      this.notify();
      return true;
    }
    if (key === "interaction.springC" && typeof value === "number") {
      this.springC = Math.max(0.1, Math.min(80, value));
      this.notify();
      return true;
    }
    if (key === "interaction.deformStrength" && typeof value === "number") {
      this.deformStrength = Math.max(0, Math.min(2, value));
      this.notify();
      return true;
    }
    if (key === "interaction.noiseAmp" && typeof value === "number") {
      this.noiseAmp = Math.max(0, Math.min(1, value));
      this.notify();
      return true;
    }
    if (key === "interaction.tauPointer" && typeof value === "number") {
      this.tauPointer = Math.max(0.01, Math.min(0.5, value));
      this.notify();
      return true;
    }
    if (key === "interaction.deadZoneRatio" && typeof value === "number") {
      this.deadZoneRatio = Math.max(0, Math.min(0.9, value));
      this.notify();
      return true;
    }
    if (key === "interaction.responseZoneRatio" && typeof value === "number") {
      this.responseZoneRatio = Math.max(0.01, Math.min(1.5, value));
      this.notify();
      return true;
    }
    if (key === "interaction.offsetCapRatio" && typeof value === "number") {
      this.offsetCapRatio = Math.max(0.1, Math.min(1.5, value));
      this.notify();
      return true;
    }
    if (key === "interaction.radiusBaseRatio" && typeof value === "number") {
      this.radiusBaseRatio = Math.max(0.05, Math.min(0.6, value));
      this.notify();
      return true;
    }
    if (key === "interaction.radiusDensityRatio" && typeof value === "number") {
      this.radiusDensityRatio = Math.max(0, Math.min(0.3, value));
      this.notify();
      return true;
    }
    if (key === "interaction.breathAmplitude" && typeof value === "number") {
      this.breathAmplitude = Math.max(0, Math.min(0.15, value));
      this.notify();
      return true;
    }
    if (key === "interaction.pointerDownBoost" && typeof value === "number") {
      this.pointerDownBoost = Math.max(1, Math.min(3, value));
      this.notify();
      return true;
    }
    if (key === "cloud.sphereRadius" && typeof value === "number") {
      this.sphereRadius = Math.max(0.2, Math.min(3, value));
      this.notify();
      return true;
    }
    if (key === "cloud.enableBloomByDefault" && typeof value === "boolean") {
      this.bloomEnabled = value;
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
    return {
      state: { ...this.state },
      visual: mapStateToVisual(this.state),
      interactionMode: this.interactionMode,
      maxOffset: this.maxOffset,
      springK: this.springK,
      springC: this.springC,
      deformStrength: this.deformStrength,
      noiseAmp: this.noiseAmp,
      tauPointer: this.tauPointer,
      deadZoneRatio: this.deadZoneRatio,
      responseZoneRatio: this.responseZoneRatio,
      offsetCapRatio: this.offsetCapRatio,
      radiusBaseRatio: this.radiusBaseRatio,
      radiusDensityRatio: this.radiusDensityRatio,
      breathAmplitude: this.breathAmplitude,
      pointerDownBoost: this.pointerDownBoost,
      sphereRadius: this.sphereRadius,
      paused: this.paused,
      bloomEnabled: this.bloomEnabled
    };
  }

  private notify(): void {
    const snap = this.snapshot();
    this.listeners.forEach((cb) => cb(snap));
  }
}
