import { clampState, State } from "./protocol";

export interface SessionData {
  state: State;
  preset: string;
  updatedAt: number;
}

const DEFAULT_STATE: State = {
  arousal: 0.5,
  valence: 0.5,
  stability: 0.5,
  load: 0.5,
  socialDrain: 0.5,
  intensity: 0.5
};

const DEFAULT_PRESET = "neutral";

class SessionStore {
  private readonly store = new Map<string, SessionData>();

  get(sessionId: string): SessionData {
    const existing = this.store.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionData = {
      state: { ...DEFAULT_STATE },
      preset: DEFAULT_PRESET,
      updatedAt: Date.now()
    };
    this.store.set(sessionId, created);
    return created;
  }

  set(sessionId: string, data: SessionData): SessionData {
    const next: SessionData = {
      state: { ...data.state },
      preset: data.preset,
      updatedAt: Date.now()
    };
    this.store.set(sessionId, next);
    return next;
  }

  patchState(sessionId: string, patch: Partial<State>): SessionData {
    const current = this.get(sessionId);
    const clamped = clampState(patch);
    const next: SessionData = {
      ...current,
      state: {
        ...current.state,
        ...clamped
      },
      updatedAt: Date.now()
    };
    this.store.set(sessionId, next);
    return next;
  }

  setPreset(sessionId: string, preset: string): SessionData {
    const current = this.get(sessionId);
    const next: SessionData = {
      ...current,
      preset,
      updatedAt: Date.now()
    };
    this.store.set(sessionId, next);
    return next;
  }
}

export const sessionStore = new SessionStore();
export { DEFAULT_STATE };
