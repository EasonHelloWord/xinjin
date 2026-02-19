import { PresetName, StateVisualInput } from "../state/types";

export type InputBusEventMap = {
  text_input: { text: string };
  voice_input: { text: string };
  system_response: { text: string; suggestedPreset?: PresetName };
  video_state_hint: { partialState: Partial<StateVisualInput> };
  user_action: { type: string };
};

type Handler<T> = (payload: T) => void;

class InputBus {
  private handlers = new Map<keyof InputBusEventMap, Set<(...args: unknown[]) => void>>();

  on<K extends keyof InputBusEventMap>(
    event: K,
    handler: Handler<InputBusEventMap[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)?.add(handler as (...args: unknown[]) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof InputBusEventMap>(
    event: K,
    handler: Handler<InputBusEventMap[K]>
  ): void {
    this.handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof InputBusEventMap>(event: K, payload: InputBusEventMap[K]): void {
    this.handlers.get(event)?.forEach((handler) => (handler as Handler<InputBusEventMap[K]>)(payload));
  }
}

export const inputBus = new InputBus();
