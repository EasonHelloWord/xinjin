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

const stateKeys: Array<keyof StateVisualInput> = [
  "arousal",
  "valence",
  "stability",
  "load",
  "socialDrain",
  "intensity"
];

const stateLabels: Record<keyof StateVisualInput, string> = {
  arousal: "唤醒度",
  valence: "愉悦度",
  stability: "稳定度",
  load: "负载",
  socialDrain: "社交消耗",
  intensity: "强度"
};

const presetByNum: PresetName[] = ["neutral", "happy", "sad", "angry", "anxious", "overloaded"];
const modeOrder: InteractionMode[] = ["gravity", "off"];
const modeLabels: Record<InteractionMode, string> = {
  gravity: "跟随",
  off: "关闭",
  repel: "排斥",
  vortex: "旋涡"
};

export function HomePage(): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [preset, setPreset] = useState<PresetName>("neutral");
  const [fps, setFps] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsConnectionState>("closed");
  const [message, setMessage] = useState<string>("");
  const [showVideoPanel, setShowVideoPanel] = useState(false);
  const [showDebug, setShowDebug] = useState(true);

  useEffect(() => {
    const off = controller.onSnapshot((snap) => setSnapshot(snap));
    return off;
  }, [controller]);

  useEffect(() => {
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
        controller.setInteractionMode(mode === "gravity" ? "off" : "gravity");
      }
      if (e.key.toLowerCase() === "b") controller.toggleBloom();
      if (e.key.toLowerCase() === "p") controller.togglePause();
      if (e.key === "0") controller.setPreset("neutral", undefined, 300);
      if (e.key.toLowerCase() === "m") setShowDebug((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  const currentState = snapshot?.state ?? defaultState;

  return (
    <div className="home-layout">
      <div className="cloud-stage" ref={canvasRef} />
      {showDebug && (
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

          <label>预设</label>
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
              {stateLabels[key]}: {currentState[key].toFixed(2)}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={currentState[key]}
                onChange={(e) => controller.setState({ [key]: Number(e.target.value) }, 240)}
              />
            </label>
          ))}

          <label>最大跟随位移
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.01}
              value={snapshot?.maxOffset ?? APP_CONFIG.interaction.maxOffset}
              onChange={(e) => controller.applyConfig("interaction.maxOffset", Number(e.target.value))}
            />
          </label>
          <label>跟随速度
            <input
              type="range"
              min={1}
              max={80}
              step={0.1}
              value={snapshot?.springK ?? APP_CONFIG.interaction.springK}
              onChange={(e) => controller.applyConfig("interaction.springK", Number(e.target.value))}
            />
          </label>
          <label>回弹阻尼
            <input
              type="range"
              min={0.1}
              max={30}
              step={0.1}
              value={snapshot?.springC ?? APP_CONFIG.interaction.springC}
              onChange={(e) => controller.applyConfig("interaction.springC", Number(e.target.value))}
            />
          </label>
          <label>形变强度
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={snapshot?.deformStrength ?? APP_CONFIG.interaction.deformStrength}
              onChange={(e) => controller.applyConfig("interaction.deformStrength", Number(e.target.value))}
            />
          </label>
          <label>边缘细节
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={snapshot?.noiseAmp ?? APP_CONFIG.interaction.noiseAmp}
              onChange={(e) => controller.applyConfig("interaction.noiseAmp", Number(e.target.value))}
            />
          </label>
          <label>跟随平滑
            <input
              type="range"
              min={0.01}
              max={0.3}
              step={0.01}
              value={snapshot?.tauPointer ?? APP_CONFIG.interaction.tauPointer}
              onChange={(e) => controller.applyConfig("interaction.tauPointer", Number(e.target.value))}
            />
          </label>
          <label>中心死区
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={snapshot?.deadZoneRatio ?? APP_CONFIG.interaction.deadZoneRatio}
              onChange={(e) => controller.applyConfig("interaction.deadZoneRatio", Number(e.target.value))}
            />
          </label>
          <label>响应半径
            <input
              type="range"
              min={0.1}
              max={1.2}
              step={0.01}
              value={snapshot?.responseZoneRatio ?? APP_CONFIG.interaction.responseZoneRatio}
              onChange={(e) => controller.applyConfig("interaction.responseZoneRatio", Number(e.target.value))}
            />
          </label>
          <label>按下形变增益
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.01}
              value={snapshot?.pointerDownBoost ?? APP_CONFIG.interaction.pointerDownBoost}
              onChange={(e) => controller.applyConfig("interaction.pointerDownBoost", Number(e.target.value))}
            />
          </label>

          <div className="btn-row">
            {modeOrder.map((mode) => (
              <button
                key={mode}
                className={snapshot?.interactionMode === mode ? "active" : ""}
                onClick={() => controller.setInteractionMode(mode)}
              >
                {modeLabels[mode]}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button onClick={() => controller.toggleBloom()}>
              辉光: {snapshot?.bloomEnabled ? "开" : "关"}
            </button>
            <button onClick={() => controller.togglePause()}>{snapshot?.paused ? "继续" : "暂停"}</button>
          </div>
          <pre>{JSON.stringify(currentState, null, 2)}</pre>
        </aside>
      )}
      <ChatDock onOpenVideoPanel={() => setShowVideoPanel(true)} />
      <VideoPanel open={showVideoPanel} onClose={() => setShowVideoPanel(false)} />
    </div>
  );
}
