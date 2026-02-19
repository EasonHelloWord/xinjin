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

const presetByNum: PresetName[] = ["neutral", "happy", "sad", "angry", "anxious", "overloaded"];
const modeOrder: InteractionMode[] = ["gravity", "off"];

export function HomePage(): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [preset, setPreset] = useState<PresetName>("neutral");
  const [fps, setFps] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsConnectionState>("closed");
  const [message, setMessage] = useState<string>("");
  const [showVideoPanel, setShowVideoPanel] = useState(false);

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
              onChange={(e) => controller.setState({ [key]: Number(e.target.value) }, 240)}
            />
          </label>
        ))}

        <label>
          attractStrength
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={snapshot?.attractStrength ?? APP_CONFIG.interaction.attractStrength}
            onChange={(e) => controller.applyConfig("interaction.attractStrength", Number(e.target.value))}
          />
        </label>
        <label>
          attractRadius
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.01}
            value={snapshot?.attractRadius ?? APP_CONFIG.interaction.attractRadius}
            onChange={(e) => controller.applyConfig("interaction.attractRadius", Number(e.target.value))}
          />
        </label>
        <label>
          stiffness
          <input
            type="range"
            min={1}
            max={40}
            step={0.1}
            value={snapshot?.stiffness ?? APP_CONFIG.interaction.stiffness}
            onChange={(e) => controller.applyConfig("interaction.stiffness", Number(e.target.value))}
          />
        </label>
        <label>
          damping
          <input
            type="range"
            min={0.2}
            max={20}
            step={0.1}
            value={snapshot?.damping ?? APP_CONFIG.interaction.damping}
            onChange={(e) => controller.applyConfig("interaction.damping", Number(e.target.value))}
          />
        </label>
        <label>
          stretchStrength
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={snapshot?.stretchStrength ?? APP_CONFIG.interaction.stretchStrength}
            onChange={(e) => controller.applyConfig("interaction.stretchStrength", Number(e.target.value))}
          />
        </label>
        <label>
          stretchMax
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={snapshot?.stretchMax ?? APP_CONFIG.interaction.stretchMax}
            onChange={(e) => controller.applyConfig("interaction.stretchMax", Number(e.target.value))}
          />
        </label>
        <label>
          hoverBoost
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={snapshot?.hoverBoost ?? APP_CONFIG.interaction.hoverBoost}
            onChange={(e) => controller.applyConfig("interaction.hoverBoost", Number(e.target.value))}
          />
        </label>
        <label>
          maxOffset
          <input
            type="range"
            min={0.05}
            max={1.2}
            step={0.01}
            value={snapshot?.maxOffset ?? APP_CONFIG.interaction.maxOffset}
            onChange={(e) => controller.applyConfig("interaction.maxOffset", Number(e.target.value))}
          />
        </label>
        <label>
          innerRadius
          <input
            type="range"
            min={0.01}
            max={1.5}
            step={0.01}
            value={snapshot?.innerRadius ?? APP_CONFIG.interaction.innerRadius}
            onChange={(e) => controller.applyConfig("interaction.innerRadius", Number(e.target.value))}
          />
        </label>
        <label>
          peakRadius
          <input
            type="range"
            min={0.05}
            max={2}
            step={0.01}
            value={snapshot?.peakRadius ?? APP_CONFIG.interaction.peakRadius}
            onChange={(e) => controller.applyConfig("interaction.peakRadius", Number(e.target.value))}
          />
        </label>
        <label>
          outerRadius
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.01}
            value={snapshot?.outerRadius ?? APP_CONFIG.interaction.outerRadius}
            onChange={(e) => controller.applyConfig("interaction.outerRadius", Number(e.target.value))}
          />
        </label>
        <label>
          relaxSpeed
          <input
            type="range"
            min={1}
            max={30}
            step={0.1}
            value={snapshot?.relaxSpeed ?? APP_CONFIG.interaction.relaxSpeed}
            onChange={(e) => controller.applyConfig("interaction.relaxSpeed", Number(e.target.value))}
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
