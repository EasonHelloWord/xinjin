import { Vector3 } from "three";
import { InteractionMode } from "../../../state/types";

export interface GravityDeformerParams {
  attractStrength: number;
  attractRadius: number;
  stiffness: number;
  damping: number;
  maxOffset: number;
  innerRadius: number;
  peakRadius: number;
  outerRadius: number;
  stretchStrength: number;
  stretchMax: number;
  relaxSpeed: number;
  hoverBoost: number;
}

export interface GravityDeformerState {
  mode: InteractionMode;
  pointerDown: boolean;
}

export interface GravityDeformerOutput {
  offset: Vector3;
  direction: Vector3;
  stretch: number;
  detailAmount: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export class GravityDeformer {
  private params: GravityDeformerParams;
  private center = new Vector3(0, 0, 0);
  private offset = new Vector3(0, 0, 0);
  private velocity = new Vector3(0, 0, 0);
  private direction = new Vector3(1, 0, 0);
  private stretch = 0;

  private targetOffset = new Vector3(0, 0, 0);
  private tmpA = new Vector3();
  private tmpB = new Vector3();

  constructor(params: GravityDeformerParams) {
    this.params = { ...params };
  }

  setParams(params: GravityDeformerParams): void {
    this.params = { ...params };
  }

  update(dt: number, pointerWorld: Vector3 | null, state: GravityDeformerState): GravityDeformerOutput {
    const safeDt = Math.min(0.05, Math.max(1 / 240, dt));
    const isActive = state.mode !== "off" && state.mode !== "repel" && state.mode !== "vortex" && pointerWorld !== null;
    const boost = state.pointerDown ? this.params.hoverBoost : 1;

    if (isActive && pointerWorld) {
      // 距离分解：以当前形变后中心(center+offset)作为距离参考。
      this.tmpA.copy(pointerWorld).sub(this.center).sub(this.offset);
      const dist = this.tmpA.length();
      // 整体牵引方向仍以云团中心为基准，保证整体跟随稳定。
      this.tmpB.copy(pointerWorld).sub(this.center);
      const radius = Math.max(0.001, this.params.attractRadius);
      const falloff =
        this.params.attractStrength *
        boost *
        Math.exp(-(dist * dist) / (2 * radius * radius));
      this.targetOffset.copy(this.tmpB).multiplyScalar(falloff);
      if (this.targetOffset.length() > this.params.maxOffset) {
        this.targetOffset.setLength(this.params.maxOffset);
      }
    } else {
      this.targetOffset.set(0, 0, 0);
    }

    // Layer A: semi-implicit Euler for spring-damper center offset.
    this.tmpB.copy(this.targetOffset).sub(this.offset).multiplyScalar(this.params.stiffness);
    this.tmpA.copy(this.velocity).multiplyScalar(this.params.damping);
    this.tmpB.sub(this.tmpA);
    this.velocity.addScaledVector(this.tmpB, safeDt);
    this.offset.addScaledVector(this.velocity, safeDt);
    if (this.offset.length() > this.params.maxOffset) {
      this.offset.setLength(this.params.maxOffset);
    }

    // Layer B: target stretch along pointer direction.
    let targetStretch = 0;
    if (isActive && pointerWorld) {
      this.tmpA.copy(pointerWorld).sub(this.center).sub(this.offset);
      const dist = this.tmpA.length();
      const dirLenSq = this.tmpA.lengthSq();
      if (dirLenSq > 1e-8) {
        this.tmpA.normalize();
        this.direction.lerp(this.tmpA, clamp01(1 - Math.exp(-this.params.relaxSpeed * safeDt)));
        this.direction.normalize();
      }

      const inner = Math.max(0.001, this.params.innerRadius);
      const peak = Math.max(inner + 0.001, this.params.peakRadius);
      const outer = Math.max(peak + 0.001, this.params.outerRadius);

      let stretchWeight = 0;
      if (dist > inner && dist < outer) {
        const x = clamp(dist / peak, 0, 2);
        const ring = x * Math.exp(1 - x); // x=1(即 dist=peak) 时达到最大值
        const innerGate = clamp01((dist - inner) / (peak - inner));
        const outerGate = clamp01((outer - dist) / (outer - peak));
        stretchWeight = ring * innerGate * outerGate;
      }

      targetStretch = this.params.stretchStrength * boost * stretchWeight;
      targetStretch = Math.min(this.params.stretchMax, Math.max(0, targetStretch));
    }
    const relaxAlpha = clamp01(1 - Math.exp(-this.params.relaxSpeed * safeDt));
    this.stretch += (targetStretch - this.stretch) * relaxAlpha;

    // Layer C control value (<= 20% of global deformation impact).
    const detailAmount = Math.min(0.2, this.stretch * 0.2);

    return {
      offset: this.offset.clone(),
      direction: this.direction.clone(),
      stretch: this.stretch,
      detailAmount
    };
  }
}
