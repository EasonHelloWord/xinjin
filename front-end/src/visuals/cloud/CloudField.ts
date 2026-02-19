import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3
} from "three";
import { APP_CONFIG } from "../../config";
import { InteractionMode } from "../../state/types";
import { CloudVisualParams } from "./mapping";
import { cloudFragmentShader, cloudVertexShader } from "./shaders";

// 着色器里用 int 表示交互模式，这里做一次映射。
const interactionModeToInt = (mode: InteractionMode): number => {
  if (mode === "attract") return 1;
  if (mode === "repel") return 2;
  if (mode === "vortex") return 3;
  return 0;
};

// 粒子云对象：封装几何体、材质、uniform 更新和资源释放。
export class CloudField {
  mesh: Points;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  private maxCount: number;
  private currentCount: number;

  constructor(count = APP_CONFIG.cloud.particleCount, radius = APP_CONFIG.cloud.sphereRadius) {
    this.maxCount = count;
    this.currentCount = count;
    this.geometry = new BufferGeometry();

    // 在球体内随机采样粒子初始位置，并生成每个粒子的随机因子。
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = radius * Math.cbrt(Math.random());
      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = r * Math.sin(phi) * Math.sin(theta);
      const sz = r * Math.cos(phi);
      const idx = i * 3;
      positions[idx] = sx;
      positions[idx + 1] = sy;
      positions[idx + 2] = sz;
      randoms[idx] = Math.random();
      randoms[idx + 1] = Math.random();
      randoms[idx + 2] = Math.random();
    }

    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setAttribute("aRandom", new BufferAttribute(randoms, 3));

    this.material = new ShaderMaterial({
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        // 这些参数会在每帧由控制器/映射更新。
        uTime: { value: 0 },
        uNoiseAmp: { value: 0.2 },
        uNoiseFreq: { value: 1.2 },
        uJitter: { value: 0.1 },
        uPointSize: { value: APP_CONFIG.cloud.pointSize },
        uBreathHz: { value: 0.14 },
        uBreathJitter: { value: 0.01 },
        uSocialSink: { value: 0.1 },
        uDensity: { value: 0.7 },
        uColorA: { value: new Color("#77aaff") },
        uColorB: { value: new Color("#3355aa") },
        uMouse: { value: new Vector3(0, 0, 0) },
        uInteractionStrength: { value: APP_CONFIG.interaction.interactionStrength },
        uInteractionRadius: { value: APP_CONFIG.interaction.interactionRadius },
        uInteractionMode: { value: 1 },
        uClickBoost: { value: 1 }
      }
    });

    this.mesh = new Points(this.geometry, this.material);
    this.geometry.setDrawRange(0, this.currentCount);
  }

  // 更新时间（驱动呼吸与噪声动画）。
  updateTime(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  // 应用映射后的视觉参数到 shader uniforms。
  applyVisual(params: CloudVisualParams): void {
    this.material.uniforms.uNoiseAmp.value = params.noiseAmplitude;
    this.material.uniforms.uNoiseFreq.value = params.noiseFrequency;
    this.material.uniforms.uJitter.value = params.jitter;
    this.material.uniforms.uPointSize.value = params.pointSize;
    this.material.uniforms.uBreathHz.value = params.breathHz;
    this.material.uniforms.uBreathJitter.value = params.breathJitter;
    this.material.uniforms.uSocialSink.value = params.socialSink;
    this.material.uniforms.uDensity.value = params.density;
    this.material.uniforms.uColorA.value.copy(params.colorA);
    this.material.uniforms.uColorB.value.copy(params.colorB);
  }

  // 设置鼠标在世界坐标中的位置。
  setMouseWorld(pos: Vector3): void {
    this.material.uniforms.uMouse.value.copy(pos);
  }

  // 设置交互模式与强度参数。
  setInteraction(mode: InteractionMode, strength: number, radius: number, clickBoost = 1): void {
    this.material.uniforms.uInteractionMode.value = interactionModeToInt(mode);
    this.material.uniforms.uInteractionStrength.value = strength;
    this.material.uniforms.uInteractionRadius.value = radius;
    this.material.uniforms.uClickBoost.value = clickBoost;
  }

  // 动态调整绘制粒子数（范围受 maxCount 限制）。
  setCount(count: number): void {
    this.currentCount = Math.max(1000, Math.min(this.maxCount, Math.floor(count)));
    this.geometry.setDrawRange(0, this.currentCount);
  }

  // 当前实际绘制粒子数。
  getCount(): number {
    return this.currentCount;
  }

  // 释放 GPU 资源。
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
