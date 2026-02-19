import { PresetName, StateVisualInput } from "../state/types";

// 事件总线消息定义：统一约束事件名与 payload 结构。
export type InputBusEventMap = {
  text_input: { text: string };
  voice_input: { text: string };
  system_response: { text: string; suggestedPreset?: PresetName };
  video_state_hint: { partialState: Partial<StateVisualInput> };
  user_action: { type: string };
};

type Handler<T> = (payload: T) => void;

// 轻量发布订阅总线：让输入模块与渲染模块解耦。
class InputBus {
  private handlers = new Map<keyof InputBusEventMap, Set<(...args: unknown[]) => void>>();

  // 订阅事件，返回取消订阅函数。
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

  // 取消订阅。
  off<K extends keyof InputBusEventMap>(
    event: K,
    handler: Handler<InputBusEventMap[K]>
  ): void {
    this.handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  // 发布事件。
  emit<K extends keyof InputBusEventMap>(event: K, payload: InputBusEventMap[K]): void {
    this.handlers.get(event)?.forEach((handler) => (handler as Handler<InputBusEventMap[K]>)(payload));
  }
}

// 全局单例。
export const inputBus = new InputBus();
