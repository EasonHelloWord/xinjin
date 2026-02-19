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

interface EngineCallbacks {
  // 实时 FPS 回调（用于 UI 显示）
  onFps?: (fps: number) => void;
  // 错误提示回调（用于页面消息框）
  onError?: (message: string) => void;
  // 自动降级提示回调
  onDegrade?: (message: string) => void;
}

// Three.js 引擎：负责场景初始化、逐帧更新、交互和性能降级。
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
  private targetMouse = new Vector3();
  private smoothMouse = new Vector3();
  private pointerDown = false;
  private fpsWindow: number[] = [];
  private degradeLevel = 0;
  private particleCount = APP_CONFIG.cloud.particleCount;

  constructor(container: HTMLElement, controller: CloudController, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.controller = controller;
    this.callbacks = callbacks;
  }

  // 初始化渲染资源并启动动画循环。
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

  // 创建后处理管线（RenderPass + Bloom）。
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

  // 外部手动设置 Bloom（实际转发给 controller 保持状态源一致）。
  setBloomEnabled(enabled: boolean): void {
    const snap = this.controller.getBloomEnabled();
    if (snap !== enabled) this.controller.setBloomEnabled(enabled);
  }

  // 主循环：更新控制器、更新粒子、渲染画面。
  private loop = (): void => {
    this.frameId = requestAnimationFrame(this.loop);
    const delta = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;
    const snapshot = this.controller.update(delta);
    if (!this.renderer || !this.camera || !this.scene || !this.cloud) return;

    if (snapshot.paused) {
      return;
    }

    // 根据阻尼换算鼠标平滑速度，避免移动过于突兀。
    const smooth = Math.max(0.02, Math.min(0.4, (1 - snapshot.damping) * 0.45 + APP_CONFIG.interaction.mouseSmooth * 0.2));
    this.smoothMouse.lerp(this.targetMouse, smooth);
    this.cloud.updateTime(elapsed);
    this.cloud.applyVisual(snapshot.visual);
    // 根据视觉密度调整实际绘制粒子数，兼顾效果与性能。
    const targetCount = Math.floor(this.particleCount * (0.4 + snapshot.visual.density * 0.6));
    this.cloud.setCount(targetCount);
    this.cloud.setMouseWorld(this.smoothMouse);
    this.cloud.setInteraction(
      snapshot.interactionMode,
      snapshot.interactionStrength,
      snapshot.interactionRadius,
      this.pointerDown ? APP_CONFIG.interaction.clickBoost : 1
    );

    // 记录 FPS，并在低帧率时自动降级。
    this.applyFpsMetric(delta);
    this.autoDegrade(snapshot.bloomEnabled);

    if (snapshot.bloomEnabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera as Camera);
    }
  };

  // 维护滑动窗口平均 FPS。
  private applyFpsMetric(delta: number): void {
    const fps = 1 / Math.max(0.0001, delta);
    this.fpsWindow.push(fps);
    if (this.fpsWindow.length > APP_CONFIG.cloud.avgWindow) {
      this.fpsWindow.shift();
    }
    const avg = this.fpsWindow.reduce((sum, v) => sum + v, 0) / this.fpsWindow.length;
    this.callbacks.onFps?.(avg);
  }

  // 自动降级策略：关 Bloom -> 降到中粒子数 -> 降到保底粒子数。
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

  // WebGL 能力检测。
  private supportWebGL(): boolean {
    try {
      const canvas = document.createElement("canvas");
      return !!window.WebGLRenderingContext && !!canvas.getContext("webgl");
    } catch {
      return false;
    }
  }

  // 响应窗口尺寸变化。
  private onResize = (): void => {
    if (!this.renderer || !this.camera || !this.composer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  // 把鼠标屏幕坐标映射到 z=0 平面世界坐标。
  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.camera) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.targetMouse);
  };

  // 鼠标按下会增加交互强度（clickBoost）。
  private onPointerDown = (): void => {
    this.pointerDown = true;
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
  };

  // 绑定所有运行时事件。
  private bindEvents(): void {
    window.addEventListener("resize", this.onResize);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  // 解绑所有运行时事件。
  private unbindEvents(): void {
    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  // 释放资源，防止内存泄漏。
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
