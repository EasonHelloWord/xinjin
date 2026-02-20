import { useEffect, useMemo, useRef, useState } from "react";
import { CloudController } from "../engine/CloudController";
import { CloudEngine } from "../engine/CloudEngine";
import { ChatDock } from "../chat/ChatDock";
import { onPulse } from "../lib/pulseBus";

interface HomePageProps {
  onLogout: () => void;
}

export function HomePage({ onLogout }: HomePageProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controller = useMemo(() => new CloudController(), []);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const pulseEnergyRef = useRef(0);
  const pulseRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const engine = new CloudEngine(el, controller);
    engine.init();
    return () => engine.dispose();
  }, [controller]);

  useEffect(() => {
    controller.setStageCenterYOffset(chatCollapsed ? 0 : -0.08);
  }, [chatCollapsed, controller]);

  useEffect(() => {
    const offPulse = onPulse((v) => {
      pulseEnergyRef.current = Math.min(1, pulseEnergyRef.current + Math.max(0.06, v));
    });

    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      pulseEnergyRef.current *= 0.86;
      const scale = 1 + pulseEnergyRef.current * 0.24;
      controller.applyConfig("cloud.sphereRadius", scale);
      pulseRafRef.current = requestAnimationFrame(tick);
    };
    pulseRafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      offPulse();
      if (pulseRafRef.current !== null) {
        cancelAnimationFrame(pulseRafRef.current);
      }
      controller.applyConfig("cloud.sphereRadius", 1);
    };
  }, [controller]);

  return (
    <div className="home-layout">
      <div className="cloud-stage" ref={canvasRef} />
      <ChatDock onCollapsedChange={setChatCollapsed} onLogout={onLogout} />
    </div>
  );
}
