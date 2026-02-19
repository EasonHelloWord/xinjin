export const APP_CONFIG = {
  wsUrl: "ws://localhost:8787",
  cloud: {
    particleCount: 2500,
    fallbackParticleCount: 1200,
    midParticleCount: 600,
    autoDegradeFpsThreshold: 45,
    avgWindow: 30,
    pointSize: 2.4,
    sphereRadius: 1.0,
    subdivisions: 6,
    background: "#04070d",
    enableBloomByDefault: true,
    bloom: {
      strength: 0.5,
      radius: 0.6,
      threshold: 0.2
    }
  },
  interaction: {
    maxOffset: 0.7,
    springK: 35,
    springC: 10,
    deformStrength: 0.25,
    deformRadius: 1.1,
    noiseAmp: 0.15,
    tauPointer: 0.08,
    hoverBoost: 1.7,
    // centerGate: 贴近中心时减弱，距离中段最强，远处衰减
    gateInner: 0.15,
    gatePeak: 0.65,
    gateOuter: 1.6
  },
  setConfigWhitelist: [
    "cloud.pointSize",
    "cloud.sphereRadius",
    "cloud.subdivisions",
    "interaction.maxOffset",
    "interaction.springK",
    "interaction.springC",
    "interaction.deformStrength",
    "interaction.deformRadius",
    "interaction.noiseAmp",
    "interaction.tauPointer",
    "interaction.hoverBoost",
    "interaction.gateInner",
    "interaction.gatePeak",
    "interaction.gateOuter",
    "cloud.enableBloomByDefault"
  ] as const
};

export type SetConfigKey = (typeof APP_CONFIG.setConfigWhitelist)[number];

