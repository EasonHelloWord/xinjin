import { APP_CONFIG } from "../config";
import { CloudController } from "./CloudController";

interface EngineCallbacks {
  onFps?: (fps: number) => void;
  onError?: (message: string) => void;
  onDegrade?: (message: string) => void;
}

interface Vec2 {
  x: number;
  y: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const angleDelta = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class CloudEngine {
  private container: HTMLElement;
  private controller: CloudController;
  private callbacks: EngineCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private frameId = 0;
  private startedAt = 0;
  private lastTs = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private renderScale = 1;
  private pointerWorld: Vec2 | null = null;
  private pointerSmoothed: Vec2 | null = null;
  private pointerDown = false;
  private offset: Vec2 = { x: 0, y: 0 };
  private velocity: Vec2 = { x: 0, y: 0 };
  private breathPhase = 0;
  private fpsWindow: number[] = [];
  private degradeLevel = 0;

  constructor(container: HTMLElement, controller: CloudController, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.controller = controller;
    this.callbacks = callbacks;
  }

  init(): void {
    if (!this.supportCanvas2D()) {
      this.callbacks.onError?.("Canvas 2D is not supported in this environment.");
      return;
    }

    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";

    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) {
      this.callbacks.onError?.("Failed to create Canvas 2D context.");
      return;
    }

    this.container.appendChild(this.canvas);
    this.resizeCanvas();
    this.bindEvents();

    this.startedAt = performance.now();
    this.lastTs = this.startedAt;
    this.loop(this.startedAt);
  }

  setBloomEnabled(enabled: boolean): void {
    const current = this.controller.getBloomEnabled();
    if (current !== enabled) this.controller.setBloomEnabled(enabled);
  }

  private loop = (ts: number): void => {
    this.frameId = requestAnimationFrame(this.loop);

    const delta = clamp((ts - this.lastTs) / 1000, 1 / 240, 0.05);
    this.lastTs = ts;
    const elapsed = (ts - this.startedAt) / 1000;

    const snapshot = this.controller.update(delta);
    if (!this.ctx || !this.canvas) return;
    if (snapshot.paused) return;

    this.updateInteraction(delta, snapshot);
    this.breathPhase += delta * 2 * Math.PI * (snapshot.visual.breathHz + snapshot.visual.breathJitter * 0.2);
    this.drawFrame(elapsed, snapshot);

    this.applyFpsMetric(delta);
    this.autoDegrade(snapshot.bloomEnabled);
  };

  private applyFpsMetric(delta: number): void {
    const fps = 1 / Math.max(0.0001, delta);
    this.fpsWindow.push(fps);
    if (this.fpsWindow.length > APP_CONFIG.cloud.avgWindow) {
      this.fpsWindow.shift();
    }
    const avg = this.fpsWindow.reduce((sum, v) => sum + v, 0) / this.fpsWindow.length;
    this.callbacks.onFps?.(avg);
  }

  private autoDegrade(bloomEnabled: boolean): void {
    if (!this.fpsWindow.length) return;

    const avg = this.fpsWindow.reduce((sum, v) => sum + v, 0) / this.fpsWindow.length;
    if (avg >= APP_CONFIG.cloud.autoDegradeFpsThreshold) return;

    if (this.degradeLevel === 0 && bloomEnabled) {
      this.controller.setBloomEnabled(false);
      this.degradeLevel = 1;
      this.callbacks.onDegrade?.("Performance degraded: bloom disabled automatically.");
      return;
    }

    if (this.degradeLevel <= 1 && this.renderScale > 0.82) {
      this.renderScale = 0.82;
      this.degradeLevel = 2;
      this.resizeCanvas();
      this.callbacks.onDegrade?.("Performance degraded: render scale reduced to 82%.");
      return;
    }

    if (this.degradeLevel <= 2 && this.renderScale > 0.66) {
      this.renderScale = 0.66;
      this.degradeLevel = 3;
      this.resizeCanvas();
      this.callbacks.onDegrade?.("Performance degraded: render scale reduced to 66%.");
    }
  }

  private supportCanvas2D(): boolean {
    try {
      const canvas = document.createElement("canvas");
      return !!canvas.getContext("2d");
    } catch {
      return false;
    }
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.ctx) return;

    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5) * this.renderScale;

    this.canvas.width = Math.max(1, Math.floor(this.width * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(this.height * this.pixelRatio));
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  private onResize = (): void => {
    this.resizeCanvas();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const rect = this.container.getBoundingClientRect();
    this.pointerWorld = {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top
    };
  };

  private onPointerDown = (): void => {
    this.pointerDown = true;
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
  };

  private onPointerLeave = (): void => {
    this.pointerWorld = null;
    this.pointerSmoothed = null;
    this.pointerDown = false;
  };

  private bindEvents(): void {
    window.addEventListener("resize", this.onResize);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private unbindEvents(): void {
    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.unbindEvents();
    if (this.canvas && this.container.contains(this.canvas)) {
      this.container.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }

  private updateInteraction(delta: number, snapshot: ReturnType<CloudController["update"]>): void {
    const alpha = 1 - Math.exp(-delta / Math.max(0.001, snapshot.tauPointer));

    if (this.pointerWorld) {
      if (!this.pointerSmoothed) {
        this.pointerSmoothed = { ...this.pointerWorld };
      } else {
        this.pointerSmoothed.x += (this.pointerWorld.x - this.pointerSmoothed.x) * alpha;
        this.pointerSmoothed.y += (this.pointerWorld.y - this.pointerSmoothed.y) * alpha;
      }
    } else {
      this.pointerSmoothed = null;
    }

    const center = this.getCenter();
    let tx = 0;
    let ty = 0;

    if (snapshot.interactionMode === "gravity" && this.pointerSmoothed) {
      tx = this.pointerSmoothed.x - center.x;
      ty = this.pointerSmoothed.y - center.y;
      const dist = Math.hypot(tx, ty);
      const deadZone = this.getBaseRadius(snapshot) * snapshot.deadZoneRatio;
      const rampZone = this.getBaseRadius(snapshot) * snapshot.responseZoneRatio;
      // Dead zone near center: ignore tiny pointer movement and ramp up smoothly outside.
      const t = clamp((dist - deadZone) / Math.max(1e-4, rampZone - deadZone), 0, 1);
      const gain = t * t * (3 - 2 * t);
      tx *= gain;
      ty *= gain;

      const maxOffsetPx = this.getBaseRadius(snapshot) * snapshot.maxOffset * snapshot.offsetCapRatio;
      const len = Math.hypot(tx, ty);
      if (len > maxOffsetPx && len > 0.0001) {
        const s = maxOffsetPx / len;
        tx *= s;
        ty *= s;
      }
    }

    const ax = (tx - this.offset.x) * snapshot.springK - this.velocity.x * snapshot.springC;
    const ay = (ty - this.offset.y) * snapshot.springK - this.velocity.y * snapshot.springC;

    this.velocity.x += ax * delta;
    this.velocity.y += ay * delta;
    this.offset.x += this.velocity.x * delta;
    this.offset.y += this.velocity.y * delta;
  }

  private drawFrame(time: number, snapshot: ReturnType<CloudController["update"]>): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = APP_CONFIG.cloud.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const center = this.getCenter();
    const cx = center.x + this.offset.x;
    const cy = center.y + this.offset.y;
    // Keep breathing phase continuous so changing arousal (frequency) does not cause size jumps.
    const breathing = Math.sin(this.breathPhase) * snapshot.breathAmplitude;
    const radius = this.getBaseRadius(snapshot) * (1 + breathing);
    const warpAmp = this.getWarpAmplitude(snapshot);
    const glowRadius = radius * (1.25 + warpAmp * 2.2);

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, glowRadius);
    glow.addColorStop(0, this.toRgba(snapshot.visual.colorA, 0.3));
    glow.addColorStop(0.65, this.toRgba(snapshot.visual.colorA, 0.12));
    glow.addColorStop(1, this.toRgba(snapshot.visual.colorA, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    const blobPath = this.createBlobPath(cx, cy, radius, warpAmp, time, snapshot);
    ctx.save();
    ctx.clip(blobPath);

    const fx = cx - radius * 0.24;
    const fy = cy - radius * 0.28;
    const body = ctx.createRadialGradient(fx, fy, radius * 0.09, cx, cy, radius * 1.03);
    body.addColorStop(0, this.toRgba(snapshot.visual.colorA, 0.95));
    body.addColorStop(0.5, this.toRgba(snapshot.visual.colorA, 0.82));
    body.addColorStop(1, this.toRgba(snapshot.visual.colorB, 0.96));
    ctx.fillStyle = body;
    const fillHalf = radius * (1.42 + warpAmp * 2.1);
    ctx.fillRect(cx - fillHalf, cy - fillHalf, fillHalf * 2, fillHalf * 2);

    const shade = ctx.createRadialGradient(cx, cy + radius * 0.45, radius * 0.05, cx, cy, radius * 1.1);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.22)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - fillHalf, cy - fillHalf, fillHalf * 2, fillHalf * 2);
    ctx.restore();

    ctx.lineWidth = Math.max(1, radius * 0.015);
    ctx.strokeStyle = this.toRgba(snapshot.visual.colorA, 0.6);
    ctx.stroke(blobPath);

    if (this.pointerSmoothed && snapshot.interactionMode === "gravity") {
      const hx = cx + (this.pointerSmoothed.x - cx) * 0.24;
      const hy = cy + (this.pointerSmoothed.y - cy) * 0.24;
      const hr = radius * (this.pointerDown ? 0.18 : 0.13);

      const highlight = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      highlight.addColorStop(0, this.toRgba(snapshot.visual.colorA, this.pointerDown ? 0.65 : 0.45));
      highlight.addColorStop(1, this.toRgba(snapshot.visual.colorA, 0));
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private getCenter(): Vec2 {
    return { x: this.width * 0.5, y: this.height * 0.52 };
  }

  private getBaseRadius(snapshot: ReturnType<CloudController["update"]>): number {
    const size = Math.min(this.width, this.height);
    const densityFactor = snapshot.radiusBaseRatio + snapshot.visual.density * snapshot.radiusDensityRatio;
    return size * densityFactor * snapshot.sphereRadius;
  }

  private getWarpAmplitude(snapshot: ReturnType<CloudController["update"]>): number {
    const base = snapshot.deformStrength * 0.018 + snapshot.noiseAmp * 0.02;
    const pressBoost = this.pointerDown ? 0.01 : 0;
    return clamp(base + pressBoost, 0.008, 0.05);
  }

  private createBlobPath(
    cx: number,
    cy: number,
    radius: number,
    amp: number,
    time: number,
    snapshot: ReturnType<CloudController["update"]>
  ): Path2D {
    const path = new Path2D();
    const seg = 72;
    const vx = this.velocity.x;
    const vy = this.velocity.y;
    const speedNorm = clamp(Math.hypot(vx, vy) / Math.max(1, radius * 3), 0, 1.5);
    const motionAngle = Math.atan2(vy, vx);
    const hasMotion = speedNorm > 0.0001;
    const pointerAngle = this.pointerSmoothed ? Math.atan2(this.pointerSmoothed.y - cy, this.pointerSmoothed.x - cx) : 0;
    const pointerDist = this.pointerSmoothed ? Math.hypot(this.pointerSmoothed.x - cx, this.pointerSmoothed.y - cy) : 0;
    const pointerNear = this.pointerSmoothed ? clamp(1 - pointerDist / Math.max(1, radius * 1.35), 0, 1) : 0;
    const deadZone = radius * snapshot.deadZoneRatio;
    const responseZone = radius * snapshot.responseZoneRatio;
    const mouseT = this.pointerSmoothed
      ? clamp((pointerDist - deadZone) / Math.max(1e-4, responseZone - deadZone), 0, 1)
      : 0;
    // Only pointer-caused deformation is gated by dead zone.
    const mouseDeformGate = mouseT * mouseT * (3 - 2 * mouseT);
    const motionStrength = speedNorm * (0.26 + snapshot.deformStrength * 0.35) * mouseDeformGate;
    const pointerStrength =
      pointerNear *
      (0.07 + snapshot.deformStrength * 0.09) *
      (this.pointerDown ? snapshot.pointerDownBoost : 1) *
      mouseDeformGate;

    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const w1 = Math.sin(a * 3 + time * 1.6);
      const w2 = Math.sin(a * 5 - time * 1.1 + 1.7) * 0.55;
      const w3 = Math.sin(a * 9 + time * 2.1 + 0.6) * 0.22;
      const baseWarp = amp * (w1 + w2 + w3);
      const motionDot = hasMotion ? Math.cos(a - motionAngle) : 0;
      const stretch = hasMotion ? motionStrength * (0.62 * motionDot + 0.22 * motionDot * motionDot * motionDot) : 0;
      const squash = hasMotion ? -motionStrength * 0.18 * (1 - motionDot * motionDot) : 0;
      const pointerDot = this.pointerSmoothed
        ? Math.exp(-Math.pow(angleDelta(a, pointerAngle), 2) / (2 * 0.42 * 0.42))
        : 0;
      const pointerBulge = pointerStrength * pointerDot;
      const total = clamp(1 + baseWarp + stretch + squash + pointerBulge, 0.82, 1.24);
      const wr = radius * total;
      const x = cx + Math.cos(a) * wr;
      const y = cy + Math.sin(a) * wr;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  private toRgba(color: { r: number; g: number; b: number }, alpha: number): string {
    return `rgba(${Math.round(clamp(color.r, 0, 1) * 255)}, ${Math.round(clamp(color.g, 0, 1) * 255)}, ${Math.round(clamp(color.b, 0, 1) * 255)}, ${clamp(alpha, 0, 1)})`;
  }
}
