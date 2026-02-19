// 主页面：整合云团渲染、WebSocket、输入事件与调试面板。
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG, SetConfigKey } from "../config";
import { inputBus } from "../events/inputBus";
import { CloudController, ControllerSnapshot } from "../engine/CloudController";
import { CloudEngine } from "../engine/CloudEngine";
import { WsClient, WsConnectionState } from "../net/wsClient";
import { PRESETS } from "../state/presets";
import { InteractionMode, PresetName, StateVisualInput, defaultState } from "../state/types";
import { ChatDock } from "../chat/ChatDock";
import { VideoPanel } from "../media/VideoPanel";

// 调试面板里可手动调节的状态键。
const stateKeys: Array<keyof StateVisualInput> = [
  "arousal",
  "valence",
  "stability",
  "load",
  "socialDrain",
  "intensity"
];

// 键盘 1..6 对应的预设顺序。
const presetByNum: PresetName[] = ["neutral", "happy", "sad", "angry", "anxious", "overloaded"];

// 交互模式按钮顺序。
const modeOrder: InteractionMode[] = ["attract", "repel", "vortex", "off"];

export function HomePage(): JSX.Element {
  // Three.js 渲染容器。
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // 控制器只创建一次，避免重复初始化状态。
  const controller = useMemo(() => new CloudController(), []);
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [preset, setPreset] = useState<PresetName>("neutral");
  const [fps, setFps] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsConnectionState>("closed");
  const [message, setMessage] = useState<string>("");
  const [showVideoPanel, setShowVideoPanel] = useState(false);

  useEffect(() => {
    // 监听控制器快照，驱动 React 面板显示。
    const off = controller.onSnapshot((snap) => setSnapshot(snap));
    return off;
  }, [controller]);

  useEffect(() => {
    // 初始化 Three.js 引擎（挂载/卸载生命周期）。
    const el = canvasRef.current;
    if (!el) return;
    const engine = new CloudEngine(el, controller, {
      onFps: setFps,
      onError: setMessage,
      onDegrade: setMessage
    });
    try {
      engine.init();
    } catch (err) {
      setMessage(`渲染初始化失败: ${(err as Error).message}`);
    }
    return () => engine.dispose();
  }, [controller]);

  useEffect(() => {
    // 建立 WS 连接，接收服务端指令并驱动控制器。
    const ws = new WsClient({
      onStatus: setWsStatus,
      onError: setMessage,
      onMessage: (msg) => {
        if (msg.type === "setState") {
          controller.setState(msg.state, msg.transitionMs ?? 500);
          return;
        }
        if (msg.type === "setPreset") {
          setPreset(msg.name);
          controller.setPreset(msg.name, msg.intensity, msg.transitionMs ?? 700);
          return;
        }
        if (msg.type === "setInteractionMode") {
          controller.setInteractionMode(msg.mode);
          return;
        }
        if (msg.type === "setConfig") {
          // 配置修改必须在白名单内，避免随意注入。
          if (!APP_CONFIG.setConfigWhitelist.includes(msg.key as SetConfigKey)) {
            setMessage(`拒绝 setConfig: ${msg.key} 不在白名单`);
            return;
          }
          controller.applyConfig(msg.key as SetConfigKey, msg.value);
        }
      }
    });
    ws.connect();
    return () => ws.close();
  }, [controller]);

  useEffect(() => {
    // 订阅系统回复与视频提示，让外部输入可以影响云团状态。
    const offSystem = inputBus.on("system_response", (payload) => {
      if (payload.suggestedPreset) {
        setPreset(payload.suggestedPreset);
        controller.setPreset(payload.suggestedPreset, undefined, 850);
      }
    });
    const offVideo = inputBus.on("video_state_hint", (payload) => {
      controller.setState(payload.partialState, 700);
    });
    return () => {
      offSystem();
      offVideo();
    };
  }, [controller]);

  useEffect(() => {
    // 键盘快捷键：
    // 1..6 切预设，Space 切 attract/repel，B 开关 Bloom，P 暂停/继续。
    const onKey = (e: KeyboardEvent): void => {
      if (e.key >= "1" && e.key <= "6") {
        const idx = Number(e.key) - 1;
        const name = presetByNum[idx];
        setPreset(name);
        controller.setPreset(name);
      }
      if (e.code === "Space") {
        e.preventDefault();
        const mode = controller.getInteractionMode();
        controller.setInteractionMode(mode === "attract" ? "repel" : "attract");
      }
      if (e.key.toLowerCase() === "b") {
        controller.toggleBloom();
      }
      if (e.key.toLowerCase() === "p") {
        controller.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  const currentState = snapshot?.state ?? defaultState;

  return (
    <div className="home-layout">
      {/* Three.js 画布挂载点 */}
      <div className="cloud-stage" ref={canvasRef} />
      <aside className="side-panel">
        <h2>状态面板</h2>
        <div className="status-row">
          <span>WS</span>
          <span className={`status-dot ${wsStatus}`}>{wsStatus}</span>
        </div>
        <div className="status-row">
          <span>FPS</span>
          <span>{fps.toFixed(1)}</span>
        </div>
        {message && <div className="message-box">{message}</div>}

        <label>Preset</label>
        <select
          value={preset}
          onChange={(e) => {
            const next = e.target.value as PresetName;
            setPreset(next);
            controller.setPreset(next, undefined, 700);
          }}
        >
          {Object.keys(PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {stateKeys.map((key) => (
          <label key={key}>
            {key}: {currentState[key].toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={currentState[key]}
              // 手动拖动单一状态项，便于实时观察效果。
              onChange={(e) => controller.setState({ [key]: Number(e.target.value) }, 240)}
            />
          </label>
        ))}

        <label>
          interactionStrength
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={snapshot?.interactionStrength ?? APP_CONFIG.interaction.interactionStrength}
            // 鼠标影响强度：大了粒子响应更明显。
            onChange={(e) => controller.applyConfig("interaction.interactionStrength", Number(e.target.value))}
          />
        </label>
        <label>
          interactionRadius
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.01}
            value={snapshot?.interactionRadius ?? APP_CONFIG.interaction.interactionRadius}
            // 鼠标影响半径：大了影响范围更大。
            onChange={(e) => controller.applyConfig("interaction.interactionRadius", Number(e.target.value))}
          />
        </label>
        <label>
          damping
          <input
            type="range"
            min={0.1}
            max={0.99}
            step={0.01}
            value={snapshot?.damping ?? APP_CONFIG.interaction.damping}
            // 阻尼：越大变化越平滑、越不“抖”。
            onChange={(e) => controller.applyConfig("interaction.damping", Number(e.target.value))}
          />
        </label>

        <div className="btn-row">
          {modeOrder.map((mode) => (
            <button
              key={mode}
              className={snapshot?.interactionMode === mode ? "active" : ""}
              onClick={() => controller.setInteractionMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button onClick={() => controller.toggleBloom()}>
            Bloom: {snapshot?.bloomEnabled ? "On" : "Off"}
          </button>
          <button onClick={() => controller.togglePause()}>{snapshot?.paused ? "继续" : "暂停"}</button>
        </div>
        <pre>{JSON.stringify(currentState, null, 2)}</pre>
      </aside>
      <ChatDock onOpenVideoPanel={() => setShowVideoPanel(true)} />
      <VideoPanel open={showVideoPanel} onClose={() => setShowVideoPanel(false)} />
    </div>
  );
}
