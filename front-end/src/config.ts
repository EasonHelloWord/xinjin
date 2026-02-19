export const APP_CONFIG = {
  wsUrl: "ws://localhost:8787",
  cloud: {
    particleCount: 50000,
    fallbackParticleCount: 10000,
    midParticleCount: 25000,
    autoDegradeFpsThreshold: 45,
    avgWindow: 30,
    pointSize: 2.4,
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
    interactionStrength: 0.45,
    interactionRadius: 0.5,
    damping: 0.9,
    mouseSmooth: 0.16,
    clickBoost: 1.8
  },
  setConfigWhitelist: [
    "cloud.pointSize",
    "interaction.interactionStrength",
    "interaction.interactionRadius",
    "interaction.damping",
    "cloud.enableBloomByDefault"
  ] as const
};

export type SetConfigKey = (typeof APP_CONFIG.setConfigWhitelist)[number];
