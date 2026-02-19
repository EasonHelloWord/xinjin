import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG, SetConfigKey } from "../config";
import { inputBus } from "../events/inputBus";
import { CloudController, ControllerSnapshot } from "../engine/CloudController";
import { CloudEngine } from "../engine/CloudEngine";
import { WsClient, WsConnectionState } from "../net/wsClient";
import { PRESETS } from "../state/presets";
import { InteractionMode, PresetName, StateVisualInput, defaultState } from "../state/types";
import { ChatDock } from "../chat/ChatDock";

const stateKeys: Array<keyof StateVisualInput> = [
  "arousal",
  "valence",
  "stability",
  "load",
  "socialDrain",
  "intensity"
];

const stateLabels: Record<keyof StateVisualInput, string> = {
  arousal: "Arousal",
  valence: "Valence",
  stability: "Stability",
  load: "Load",
  socialDrain: "Social Drain",
  intensity: "Intensity"
};

const presetByNum: PresetName[] = ["neutral", "happy", "sad", "angry", "anxious", "overloaded"];
const modeOrder: InteractionMode[] = ["gravity", "off"];
const modeLabels: Record<InteractionMode, string> = {
  gravity: "Follow",
  off: "Off",
  repel: "Repel",
  vortex: "Vortex"
};

const normalizePreset = (raw: string): PresetName => {
  if (raw === "tired") return "overloaded";
  if (raw === "calm") return "happy";
  if (
    raw === "neutral" ||
    raw === "happy" ||
    raw === "sad" ||
    raw === "angry" ||
    raw === "anxious" ||
    raw === "overloaded"
  ) {
    return raw;
  }
  return "neutral";
};

export function HomePage(): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [preset, setPreset] = useState<PresetName>("neutral");
  const [fps, setFps] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsConnectionState>("closed");
  const [message, setMessage] = useState<string>("");
  const [showDebug, setShowDebug] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
      setMessage(`Renderer init failed: ${(err as Error).message}`);
    }

    return () => engine.dispose();
  }, [controller]);

  useEffect(() => {
    const ws = new WsClient({
      onStatus: setWsStatus,
      onError: setMessage,
      onMessage: (msg) => {
        if (msg.type === "system_response") {
          const suggested = msg.suggestedPreset ? normalizePreset(msg.suggestedPreset) : undefined;
          inputBus.emit("system_response", { text: msg.text, suggestedPreset: suggested });
          return;
        }

        if (msg.type === "set_state") {
          controller.setState(msg.state, msg.transitionMs ?? 500);
          return;
        }

        if (msg.type === "set_preset") {
          const normalized = normalizePreset(msg.name);
          setPreset(normalized);
          controller.setPreset(normalized, msg.intensity, msg.transitionMs ?? 700);
          return;
        }

        if (msg.type === "error") {
          setMessage(`[${msg.code}] ${msg.message}`);
          return;
        }

        // Backward-compatible messages
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
            setMessage(`Rejected setConfig: ${msg.key}`);
            return;
          }
          controller.applyConfig(msg.key as SetConfigKey, msg.value);
        }
      }
    });

    const offTextInput = inputBus.on("text_input", ({ text }) => {
      const ok = ws.sendTextInput(text);
      if (!ok) {
        setMessage("WS not ready. Message not sent.");
      }
    });

    ws.connect();

    return () => {
      offTextInput();
      ws.close();
    };
  }, [controller]);

  useEffect(() => {
    const offSystem = inputBus.on("system_response", (payload) => {
      if (payload.suggestedPreset) {
        setPreset(payload.suggestedPreset);
        controller.setPreset(payload.suggestedPreset, undefined, 850);
      }
    });
    return () => offSystem();
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

  useEffect(() => {
    controller.setStageCenterYOffset(chatCollapsed ? 0 : -0.08);
  }, [chatCollapsed, controller]);

  const currentState = snapshot?.state ?? defaultState;

  return (
    <div className="home-layout">
      <div className="cloud-stage" ref={canvasRef} />
      {showDebug && (
        <aside className="side-panel">
          <h2>Status Panel</h2>
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

          <label>
            Max Offset
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.01}
              value={snapshot?.maxOffset ?? APP_CONFIG.interaction.maxOffset}
              onChange={(e) => controller.applyConfig("interaction.maxOffset", Number(e.target.value))}
            />
          </label>
          <label>
            Follow Speed
            <input
              type="range"
              min={1}
              max={80}
              step={0.1}
              value={snapshot?.springK ?? APP_CONFIG.interaction.springK}
              onChange={(e) => controller.applyConfig("interaction.springK", Number(e.target.value))}
            />
          </label>
          <label>
            Damping
            <input
              type="range"
              min={0.1}
              max={30}
              step={0.1}
              value={snapshot?.springC ?? APP_CONFIG.interaction.springC}
              onChange={(e) => controller.applyConfig("interaction.springC", Number(e.target.value))}
            />
          </label>
          <label>
            Deform Strength
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={snapshot?.deformStrength ?? APP_CONFIG.interaction.deformStrength}
              onChange={(e) => controller.applyConfig("interaction.deformStrength", Number(e.target.value))}
            />
          </label>
          <label>
            Noise
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={snapshot?.noiseAmp ?? APP_CONFIG.interaction.noiseAmp}
              onChange={(e) => controller.applyConfig("interaction.noiseAmp", Number(e.target.value))}
            />
          </label>
          <label>
            Pointer Tau
            <input
              type="range"
              min={0.01}
              max={0.3}
              step={0.01}
              value={snapshot?.tauPointer ?? APP_CONFIG.interaction.tauPointer}
              onChange={(e) => controller.applyConfig("interaction.tauPointer", Number(e.target.value))}
            />
          </label>
          <label>
            Dead Zone
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={snapshot?.deadZoneRatio ?? APP_CONFIG.interaction.deadZoneRatio}
              onChange={(e) => controller.applyConfig("interaction.deadZoneRatio", Number(e.target.value))}
            />
          </label>
          <label>
            Response Zone
            <input
              type="range"
              min={0.1}
              max={1.2}
              step={0.01}
              value={snapshot?.responseZoneRatio ?? APP_CONFIG.interaction.responseZoneRatio}
              onChange={(e) => controller.applyConfig("interaction.responseZoneRatio", Number(e.target.value))}
            />
          </label>
          <label>
            Pointer Boost
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
              Bloom: {snapshot?.bloomEnabled ? "On" : "Off"}
            </button>
            <button onClick={() => controller.togglePause()}>{snapshot?.paused ? "Resume" : "Pause"}</button>
          </div>
          <pre>{JSON.stringify(currentState, null, 2)}</pre>
        </aside>
      )}
      <ChatDock onCollapsedChange={setChatCollapsed} />
    </div>
  );
}
