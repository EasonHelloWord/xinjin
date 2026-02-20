type PulseListener = (v: number) => void;

const listeners = new Set<PulseListener>();

export const emitPulse = (v: number): void => {
  const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  listeners.forEach((listener) => listener(next));
};

export const onPulse = (listener: PulseListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

