export type InteractionMode = "attract" | "repel" | "vortex" | "off";

export interface StateVisualInput {
  arousal: number;
  valence: number;
  stability: number;
  load: number;
  socialDrain: number;
  intensity: number;
}

export type PresetName =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "anxious"
  | "overloaded";

export const defaultState: StateVisualInput = {
  arousal: 0.45,
  valence: 0.5,
  stability: 0.6,
  load: 0.35,
  socialDrain: 0.3,
  intensity: 0.5
};

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const normalizeState = (
  state: Partial<StateVisualInput>,
  base: StateVisualInput
): StateVisualInput => {
  return {
    arousal: clamp01(state.arousal ?? base.arousal),
    valence: clamp01(state.valence ?? base.valence),
    stability: clamp01(state.stability ?? base.stability),
    load: clamp01(state.load ?? base.load),
    socialDrain: clamp01(state.socialDrain ?? base.socialDrain),
    intensity: clamp01(state.intensity ?? base.intensity)
  };
};
