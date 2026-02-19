import { PresetName, StateVisualInput } from "./types";

export const PRESETS: Record<PresetName, StateVisualInput> = {
  neutral: {
    arousal: 0.45,
    valence: 0.5,
    stability: 0.62,
    load: 0.35,
    socialDrain: 0.3,
    intensity: 0.5
  },
  happy: {
    arousal: 0.72,
    valence: 0.86,
    stability: 0.68,
    load: 0.25,
    socialDrain: 0.18,
    intensity: 0.7
  },
  sad: {
    arousal: 0.28,
    valence: 0.18,
    stability: 0.58,
    load: 0.32,
    socialDrain: 0.62,
    intensity: 0.46
  },
  angry: {
    arousal: 0.88,
    valence: 0.2,
    stability: 0.24,
    load: 0.78,
    socialDrain: 0.5,
    intensity: 0.86
  },
  anxious: {
    arousal: 0.82,
    valence: 0.3,
    stability: 0.18,
    load: 0.74,
    socialDrain: 0.56,
    intensity: 0.8
  },
  overloaded: {
    arousal: 0.74,
    valence: 0.36,
    stability: 0.14,
    load: 0.96,
    socialDrain: 0.78,
    intensity: 0.95
  }
};
