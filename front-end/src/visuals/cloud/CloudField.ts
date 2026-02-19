import {
  AdditiveBlending,
  Color,
  IcosahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3
} from "three";
import { APP_CONFIG } from "../../config";
import { InteractionMode } from "../../state/types";
import { CloudVisualParams } from "./mapping";
import { cloudFragmentShader, cloudVertexShader } from "./shaders";

export interface CloudInteractionState {
  mode: InteractionMode;
  maxOffset: number;
  springK: number;
  springC: number;
  deformStrength: number;
  deformRadius: number;
  noiseAmp: number;
  tauPointer: number;
  hoverBoost: number;
  gateInner: number;
  gatePeak: number;
  gateOuter: number;
}

const modeToInt = (mode: InteractionMode): number => {
  if (mode === "gravity") return 1;
  if (mode === "repel") return 2;
  if (mode === "vortex") return 3;
  return 0;
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export class CloudField {
  mesh: Mesh;
  private geometry: IcosahedronGeometry;
  private material: ShaderMaterial;
  private pointerSmoothed = new Vector3();
  private hasPointer = false;
  private center = new Vector3(0, 0, 0);
  private offset = new Vector3();
  private velocity = new Vector3();
  private interactionMode: InteractionMode = "gravity";

  constructor(_count = APP_CONFIG.cloud.particleCount, radius = APP_CONFIG.cloud.sphereRadius) {
    this.geometry = new IcosahedronGeometry(radius, APP_CONFIG.cloud.subdivisions);
    this.material = new ShaderMaterial({
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOffset: { value: new Vector3() },
        uAttractor: { value: new Vector3() },
        uDeformStrength: { value: APP_CONFIG.interaction.deformStrength },
        uDeformRadius: { value: APP_CONFIG.interaction.deformRadius },
        uNoiseAmp: { value: APP_CONFIG.interaction.noiseAmp },
        uGateInner: { value: APP_CONFIG.interaction.gateInner },
        uGatePeak: { value: APP_CONFIG.interaction.gatePeak },
        uGateOuter: { value: APP_CONFIG.interaction.gateOuter },
        uBreathHz: { value: 0.14 },
        uBreathJitter: { value: 0.01 },
        uColorA: { value: new Color("#77aaff") },
        uColorB: { value: new Color("#3355aa") },
        uInteractionMode: { value: 1 }
      }
    });
    this.mesh = new Mesh(this.geometry, this.material);
  }

  updateTime(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  applyVisual(params: CloudVisualParams): void {
    this.material.uniforms.uBreathHz.value = params.breathHz;
    this.material.uniforms.uBreathJitter.value = params.breathJitter;
    this.material.uniforms.uColorA.value.copy(params.colorA);
    this.material.uniforms.uColorB.value.copy(params.colorB);
  }

  updateInteraction(dt: number, pointerWorld: Vector3 | null, state: CloudInteractionState, pointerDown: boolean): void {
    const dtClamped = clamp(dt, 1 / 240, 1 / 30);
    const alpha = 1 - Math.exp(-dtClamped / Math.max(0.001, state.tauPointer));
    if (pointerWorld) {
      if (!this.hasPointer) {
        this.pointerSmoothed.copy(pointerWorld);
        this.hasPointer = true;
      } else {
        this.pointerSmoothed.lerp(pointerWorld, alpha);
      }
    } else {
      this.hasPointer = false;
    }

    const target = new Vector3();
    if (this.interactionMode === "gravity" && this.hasPointer) {
      target.copy(this.pointerSmoothed).sub(this.center);
      if (target.length() > state.maxOffset) {
        target.setLength(state.maxOffset);
      }
    }

    // semi-implicit Euler spring-damper
    const acc = target.clone().sub(this.offset).multiplyScalar(state.springK).addScaledVector(this.velocity, -state.springC);
    this.velocity.addScaledVector(acc, dtClamped);
    this.offset.addScaledVector(this.velocity, dtClamped);

    const boost = pointerDown ? state.hoverBoost : 1;
    this.material.uniforms.uOffset.value.copy(this.offset);
    this.material.uniforms.uAttractor.value.copy(this.hasPointer ? this.pointerSmoothed : this.center);
    this.material.uniforms.uDeformStrength.value = state.deformStrength * boost;
    this.material.uniforms.uDeformRadius.value = state.deformRadius;
    this.material.uniforms.uNoiseAmp.value = state.noiseAmp;
    this.material.uniforms.uGateInner.value = state.gateInner;
    this.material.uniforms.uGatePeak.value = state.gatePeak;
    this.material.uniforms.uGateOuter.value = state.gateOuter;
    this.material.uniforms.uInteractionMode.value = modeToInt(this.interactionMode);
    this.mesh.position.copy(this.center).add(this.offset);
  }

  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode;
  }

  setCount(_count: number): void {}

  getCount(): number {
    return 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

