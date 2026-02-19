// 全局配置：集中管理可调参数，便于后续做配置面板或服务端动态下发。
export const APP_CONFIG = {
  // WebSocket 默认地址（联调服务端时最常改这里）
  wsUrl: "ws://localhost:8787",
  cloud: {
    // 默认粒子数量（性能差可调小）
    particleCount: 50000,
    fallbackParticleCount: 10000,
    midParticleCount: 25000,
    // 低于该 FPS 时自动降级
    autoDegradeFpsThreshold: 45,
    // FPS 平均窗口大小
    avgWindow: 30,
    // 粒子基础大小
    pointSize: 2.4,
    // 初始球体半径
    sphereRadius: 1.35,
    background: "#04070d",
    enableBloomByDefault: true,
    bloom: {
      strength: 0.75,
      radius: 0.6,
      threshold: 0.2
    }
  },
  interaction: {
    // 鼠标与粒子交互强度
    interactionStrength: 0.45,
    // 鼠标影响半径
    interactionRadius: 0.5,
    // 阻尼：越大越“稳”，变化更慢
    damping: 0.9,
    // 鼠标平滑系数
    mouseSmooth: 0.16,
    // 鼠标按下时交互增益
    clickBoost: 1.8
  },
  // 允许被 setConfig 动态修改的键（白名单）
  setConfigWhitelist: [
    "cloud.pointSize",
    "interaction.interactionStrength",
    "interaction.interactionRadius",
    "interaction.damping",
    "cloud.enableBloomByDefault"
  ] as const
};

// 从白名单自动推导出合法 key 类型，避免写错字符串。
export type SetConfigKey = (typeof APP_CONFIG.setConfigWhitelist)[number];
