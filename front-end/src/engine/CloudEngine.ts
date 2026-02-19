import {
  Camera,
  Clock,
  Color,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { APP_CONFIG } from "../config";
import { CloudController } from "./CloudController";
import { CloudField } from "../visuals/cloud/CloudField";
import { pointerEventToNdc, projectPointerToPlane } from "../visuals/cloud/interaction/pointer";

interface EngineCallbacks {
  onFps?: (fps: number) => void;
  onError?: (message: string) => void;
  onDegrade?: (message: string) => void;
}

export class CloudEngine {
  private container: HTMLElement;
  private controller: CloudController;
  private callbacks: EngineCallbacks;
  private renderer: WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private camera: PerspectiveCamera | null = null;
  private scene: Scene | null = null;
  private cloud: CloudField | null = null;
  private clock = new Clock();
  private frameId = 0;
  private raycaster = new Raycaster();
  private plane = new Plane(new Vector3(0, 0, 1), 0);
  private ndc = new Vector2();
  private targetPointer = new Vector3();
  private smoothPointer = new Vector3();
  private restPointer = new Vector3(0, 0, 0);
  private pointerWorld: Vector3 | null = null;
  private pointerDown = false;
  private fpsWindow: number[] = [];
  private degradeLevel = 0;
  private particleCount = APP_CONFIG.cloud.particleCount;

  constructor(container: HTMLElement, controller: CloudController, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.controller = controller;
    this.callbacks = callbacks;
  }

  init(): void {
    if (!this.supportWebGL()) {
      this.callbacks.onError?.("当前环境不支持 WebGL，无法初始化云团渲染。");
      return;
    }
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.scene = new Scene();
    this.scene.background = new Color(APP_CONFIG.cloud.background);
    this.camera = new PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 6.3);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    this.cloud = new CloudField(APP_CONFIG.cloud.particleCount);
    this.scene.add(this.cloud.mesh);
    this.createComposer(width, height);

    this.bindEvents();
    this.clock.start();
    this.loop();
  }

  private createComposer(width: number, height: number): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      APP_CONFIG.cloud.bloom.strength,
      APP_CONFIG.cloud.bloom.radius,
      APP_CONFIG.cloud.bloom.threshold
    );
    this.composer.addPass(bloomPass);
  }

  setBloomEnabled(enabled: boolean): void {
    const snap = this.controller.getBloomEnabled();
    if (snap !== enabled) this.controller.setBloomEnabled(enabled);
  }

  private loop = (): void => {
    this.frameId = requestAnimationFrame(this.loop);
    const delta = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;
    const snapshot = this.controller.update(delta);
    if (!this.renderer || !this.camera || !this.scene || !this.cloud) return;

    if (snapshot.paused) {
      return;
    }

    const smooth = Math.max(0.02, Math.min(0.4, APP_CONFIG.interaction.mouseSmooth));
    const pointerTarget = this.pointerWorld ? this.targetPointer : this.restPointer;
    this.smoothPointer.lerp(pointerTarget, smooth);

    this.cloud.updateTime(elapsed);
    this.cloud.applyVisual(snapshot.visual);
    const targetCount = Math.floor(this.particleCount * (0.4 + snapshot.visual.density * 0.6));
    this.cloud.setCount(targetCount);
    this.cloud.updateInteraction(delta, this.pointerWorld ? this.smoothPointer : null, {
      mode: snapshot.interactionMode,
      pointerDown: this.pointerDown,
      attractStrength: snapshot.attractStrength,
      attractRadius: snapshot.attractRadius,
      stiffness: snapshot.stiffness,
      damping: snapshot.damping,
      maxOffset: snapshot.maxOffset,
      innerRadius: snapshot.innerRadius,
      peakRadius: snapshot.peakRadius,
      outerRadius: snapshot.outerRadius,
      stretchStrength: snapshot.stretchStrength,
      stretchMax: snapshot.stretchMax,
      relaxSpeed: snapshot.relaxSpeed,
      hoverBoost: snapshot.hoverBoost,
      clickBoost: this.pointerDown ? APP_CONFIG.interaction.clickBoost : 1
    });

    this.applyFpsMetric(delta);
    this.autoDegrade(snapshot.bloomEnabled);

    if (snapshot.bloomEnabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera as Camera);
    }
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
    if (!this.fpsWindow.length || !this.cloud) return;
    const avg = this.fpsWindow.reduce((sum, v) => sum + v, 0) / this.fpsWindow.length;
    if (avg >= APP_CONFIG.cloud.autoDegradeFpsThreshold) return;

    if (this.degradeLevel === 0 && bloomEnabled) {
      this.controller.setBloomEnabled(false);
      this.degradeLevel = 1;
      this.callbacks.onDegrade?.("性能降级：已自动关闭 bloom。");
      return;
    }
    if (this.degradeLevel <= 1 && this.particleCount > APP_CONFIG.cloud.midParticleCount) {
      this.particleCount = APP_CONFIG.cloud.midParticleCount;
      this.cloud.setCount(this.particleCount);
      this.degradeLevel = 2;
      this.callbacks.onDegrade?.(`性能降级：粒子数降低到 ${this.particleCount}。`);
      return;
    }
    if (this.degradeLevel <= 2 && this.particleCount > APP_CONFIG.cloud.fallbackParticleCount) {
      this.particleCount = APP_CONFIG.cloud.fallbackParticleCount;
      this.cloud.setCount(this.particleCount);
      this.degradeLevel = 3;
      this.callbacks.onDegrade?.(`性能降级：粒子数降低到 ${this.particleCount}。`);
    }
  }

  private supportWebGL(): boolean {
    try {
      const canvas = document.createElement("canvas");
      return !!window.WebGLRenderingContext && !!canvas.getContext("webgl");
    } catch {
      return false;
    }
  }

  private onResize = (): void => {
    if (!this.renderer || !this.camera || !this.composer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.camera) return;
    pointerEventToNdc(ev, this.container, this.ndc);
    const hit = projectPointerToPlane(this.ndc, this.camera, this.raycaster, this.plane, this.targetPointer);
    if (hit) {
      this.pointerWorld = this.targetPointer;
    }
  };

  private onPointerDown = (): void => {
    this.pointerDown = true;
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
  };

  private onPointerLeave = (): void => {
    this.pointerWorld = null;
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
    this.cloud?.dispose();
    this.scene?.clear();
    this.composer?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement && this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
