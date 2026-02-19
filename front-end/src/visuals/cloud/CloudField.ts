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
import {
  GravityDeformer,
  GravityDeformerParams,
  GravityDeformerState
} from "./interaction/GravityDeformer";
import { CloudVisualParams } from "./mapping";
import { cloudFragmentShader, cloudVertexShader } from "./shaders";

export interface CloudInteractionState extends GravityDeformerState, GravityDeformerParams {
  clickBoost: number;
}

const modeToInt = (mode: InteractionMode): number => {
  if (mode === "gravity") return 1;
  if (mode === "repel") return 2;
  if (mode === "vortex") return 3;
  return 0;
};

export class CloudField {
  mesh: Points;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  private maxCount: number;
  private currentCount: number;
  private deformer: GravityDeformer;

  constructor(count = APP_CONFIG.cloud.particleCount, radius = APP_CONFIG.cloud.sphereRadius) {
    this.maxCount = count;
    this.currentCount = count;
    this.geometry = new BufferGeometry();
    this.deformer = new GravityDeformer({
      attractStrength: APP_CONFIG.interaction.attractStrength,
      attractRadius: APP_CONFIG.interaction.attractRadius,
      stiffness: APP_CONFIG.interaction.stiffness,
      damping: APP_CONFIG.interaction.damping,
      maxOffset: APP_CONFIG.interaction.maxOffset,
      innerRadius: APP_CONFIG.interaction.innerRadius,
      peakRadius: APP_CONFIG.interaction.peakRadius,
      outerRadius: APP_CONFIG.interaction.outerRadius,
      stretchStrength: APP_CONFIG.interaction.stretchStrength,
      stretchMax: APP_CONFIG.interaction.stretchMax,
      relaxSpeed: APP_CONFIG.interaction.relaxSpeed,
      hoverBoost: APP_CONFIG.interaction.hoverBoost
    });

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
        uPointer: { value: new Vector3(0, 0, 0) },
        uOffset: { value: new Vector3(0, 0, 0) },
        uDir: { value: new Vector3(1, 0, 0) },
        uStretch: { value: 0 },
        uDetailAmount: { value: 0 },
        uInteractionMode: { value: 1 },
        uClickBoost: { value: 1 }
      }
    });

    this.mesh = new Points(this.geometry, this.material);
    this.geometry.setDrawRange(0, this.currentCount);
  }

  updateTime(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

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

  updateInteraction(dt: number, pointerWorld: Vector3 | null, state: CloudInteractionState): void {
    this.deformer.setParams({
      attractStrength: state.attractStrength,
      attractRadius: state.attractRadius,
      stiffness: state.stiffness,
      damping: state.damping,
      maxOffset: state.maxOffset,
      innerRadius: state.innerRadius,
      peakRadius: state.peakRadius,
      outerRadius: state.outerRadius,
      stretchStrength: state.stretchStrength,
      stretchMax: state.stretchMax,
      relaxSpeed: state.relaxSpeed,
      hoverBoost: state.hoverBoost
    });
    const output = this.deformer.update(dt, pointerWorld, {
      mode: state.mode,
      pointerDown: state.pointerDown
    });
    if (pointerWorld) {
      this.material.uniforms.uPointer.value.copy(pointerWorld);
    }
    this.material.uniforms.uOffset.value.copy(output.offset);
    this.material.uniforms.uDir.value.copy(output.direction);
    this.material.uniforms.uStretch.value = output.stretch;
    this.material.uniforms.uDetailAmount.value = output.detailAmount;
    this.material.uniforms.uInteractionMode.value = modeToInt(state.mode);
    this.material.uniforms.uClickBoost.value = state.clickBoost;
  }

  setCount(count: number): void {
    this.currentCount = Math.max(1000, Math.min(this.maxCount, Math.floor(count)));
    this.geometry.setDrawRange(0, this.currentCount);
  }

  getCount(): number {
    return this.currentCount;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
