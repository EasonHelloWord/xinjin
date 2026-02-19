export const APP_CONFIG = {
  wsUrl: "ws://localhost:8787",
  voiceStreamUrl: "ws://localhost:8787/voice",
  cloud: {
    autoDegradeFpsThreshold: 45,
    avgWindow: 30,
    sphereRadius: 1.0,
    background: "#04070d",
    enableBloomByDefault: true,
    bloom: {
      strength: 0.5,
      radius: 0.6,
      threshold: 0.2
    }
  },
  interaction: {
    // 圆球跟随鼠标时，球心最大偏移（相对球半径的比例）。
    maxOffset: 0.8,
    // 弹簧刚度：越大跟随越快、越“紧”。
    springK: 15,
    // 弹簧阻尼：越大抖动和回弹越少。
    springC: 8,
    // 边缘形变总强度。
    deformStrength: 0.25,
    // 边缘细节噪声强度。
    noiseAmp: 0.55,
    // 鼠标平滑时间常数（秒）：越小响应越快。
    tauPointer: 0.28,
    // 球心“死区”半径比例（相对球半径）。
    // 鼠标在这一区域内移动时，对球体影响接近 0。
    deadZoneRatio: 0.22,
    // 响应区外边界比例（相对球半径）。
    // 影响强度会在 deadZoneRatio -> responseZoneRatio 之间平滑爬升。
    responseZoneRatio: 0.62,
    // 响应映射后最终位移的硬上限比例。
    offsetCapRatio: 0.75,
    // 球体基础尺寸比例（相对于视口短边）。
    radiusBaseRatio: 0.19,
    // 由状态密度带来的额外尺寸增量比例（叠加在基础尺寸上）。
    radiusDensityRatio: 0.03,
    // 呼吸动画的缩放振幅。
    breathAmplitude: 0.09,
    // 按下鼠标时的局部形变增益。
    pointerDownBoost: 0
  },
  setConfigWhitelist: [
    "cloud.sphereRadius",
    "interaction.maxOffset",
    "interaction.springK",
    "interaction.springC",
    "interaction.deformStrength",
    "interaction.noiseAmp",
    "interaction.tauPointer",
    "interaction.deadZoneRatio",
    "interaction.responseZoneRatio",
    "interaction.offsetCapRatio",
    "interaction.radiusBaseRatio",
    "interaction.radiusDensityRatio",
    "interaction.breathAmplitude",
    "interaction.pointerDownBoost",
    "cloud.enableBloomByDefault"
  ] as const
};

export type SetConfigKey = (typeof APP_CONFIG.setConfigWhitelist)[number];
