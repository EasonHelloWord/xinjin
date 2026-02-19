// 全局配置：集中管理可调参数，便于后续做配置面板或服务端动态下发。
export const APP_CONFIG = {
  // WebSocket 默认地址（联调服务端时最常改这里）
  wsUrl: "ws://localhost:8787",
  cloud: {
    // 默认粒子数量（性能差可调小）
    particleCount: 2500,
    fallbackParticleCount: 1200,
    midParticleCount: 600,
    // 低于该 FPS 时自动降级
    autoDegradeFpsThreshold: 45,
    // FPS 平均窗口大小
    avgWindow: 30,
    // 粒子基础大小
    pointSize: 2.4,
    // 初始球体半径
    sphereRadius: 0.8,
    background: "#04070d",
    enableBloomByDefault: true,
    bloom: {
      strength: 0.75,
      radius: 0.6,
      threshold: 0.2
    }
  },
  interaction: {
    // 全局吸引强度（越大越容易整体跟随）
    attractStrength: 0.9,
    // 吸引作用半径（越大在更远距离也会被牵引）
    attractRadius: 1.25,
    // 弹簧刚度（回弹速度）
    stiffness: 18,
    // 阻尼（抑制振荡）
    damping: 8.5,
    // 整体位移上限，防止“飞走”
    maxOffset: 0.6,
    // 拉伸内圈半径：进入此范围后拉伸会减弱到接近 0
    innerRadius: 0.2,
    // 拉伸峰值半径：在该距离附近拉伸最强
    peakRadius: 0.65,
    // 拉伸外圈半径：超过后拉伸衰减到 0
    outerRadius: 1.35,
    // 拉伸强度（沿鼠标方向变长）
    stretchStrength: 0.4,
    // 拉伸上限
    stretchMax: 0.52,
    // 拉伸松弛速度（移开后恢复）
    relaxSpeed: 10,
    // 鼠标按下时增强倍率
    hoverBoost: 1.7,
    // 鼠标平滑系数
    mouseSmooth: 0.16,
    // 鼠标按下时交互增益
    clickBoost: 1.8
  },
  // 允许被 setConfig 动态修改的键（白名单）
  setConfigWhitelist: [
    "cloud.pointSize",
    "interaction.attractStrength",
    "interaction.attractRadius",
    "interaction.stiffness",
    "interaction.damping",
    "interaction.maxOffset",
    "interaction.innerRadius",
    "interaction.peakRadius",
    "interaction.outerRadius",
    "interaction.stretchStrength",
    "interaction.stretchMax",
    "interaction.relaxSpeed",
    "interaction.hoverBoost",
    "cloud.enableBloomByDefault"
  ] as const
};

// 从白名单自动推导出合法 key 类型，避免写错字符串。
export type SetConfigKey = (typeof APP_CONFIG.setConfigWhitelist)[number];
