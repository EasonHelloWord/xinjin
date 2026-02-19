import { Color } from "three";
import { StateVisualInput } from "../../state/types";

export interface CloudVisualParams {
  colorA: Color;
  colorB: Color;
  noiseAmplitude: number;
  noiseFrequency: number;
  jitter: number;
  density: number;
  pointSize: number;
  breathHz: number;
  breathJitter: number;
  socialSink: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const mapStateToVisual = (state: StateVisualInput): CloudVisualParams => {
  const hue = lerp(0.6, 0.03, state.valence);
  const saturation = lerp(0.35, 0.9, state.arousal);
  const lightness = lerp(0.38, 0.72, state.arousal);

  const edgeHue = (hue + 0.08 * (1 - state.valence)) % 1;
  const colorA = new Color().setHSL(hue, saturation, lightness);
  const colorB = new Color().setHSL(edgeHue, Math.max(0.25, saturation - 0.2), Math.max(0.2, lightness - 0.18));

  const loadBoost = state.load * 0.7 + state.intensity * 0.3;
  const noiseAmplitude = lerp(0.06, 0.42, loadBoost);
  const noiseFrequency = lerp(0.6, 3.2, state.load);
  const jitter = lerp(0.02, 0.35, 1 - state.stability);

  const density = lerp(0.36, 1, Math.min(1, state.intensity * 0.65 + state.load * 0.35));
  const pointSize = lerp(1.8, 3.1, density);

  const breathHz = lerp(0.08, 0.25, state.arousal);
  const breathJitter = lerp(0.001, 0.04, 1 - state.stability);

  const socialSink = lerp(0, 0.38, state.socialDrain);

  return {
    colorA,
    colorB,
    noiseAmplitude,
    noiseFrequency,
    jitter,
    density,
    pointSize,
    breathHz,
    breathJitter,
    socialSink
  };
};
