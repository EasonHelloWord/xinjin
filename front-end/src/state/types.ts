// 粒子与鼠标的交互模式。
export type InteractionMode = "attract" | "repel" | "vortex" | "off";

// 可视化状态输入（建议都保持在 0..1 区间）。
export interface StateVisualInput {
  // 兴奋度：越高通常动画越活跃
  arousal: number;
  // 正负情绪：越高颜色更偏明亮/积极
  valence: number;
  // 稳定度：越低抖动通常越明显
  stability: number;
  // 负载：越高噪声和复杂度通常越高
  load: number;
  // 社交消耗：越高会有更多下沉感
  socialDrain: number;
  // 总体强度：影响密度等视觉强弱
  intensity: number;
}

// 预设名：用于快速切换一组状态值。
export type PresetName =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "anxious"
  | "overloaded";

// 默认状态：应用启动时的初始值。
export const defaultState: StateVisualInput = {
  arousal: 0.45,
  valence: 0.5,
  stability: 0.6,
  load: 0.35,
  socialDrain: 0.3,
  intensity: 0.5
};

// 把数字限制在 0..1 之间。
export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// 用 partial 覆盖 base，并对每个字段做 0..1 限制。
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
