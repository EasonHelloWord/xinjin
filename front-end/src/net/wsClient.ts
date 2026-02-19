import { APP_CONFIG } from "../config";
import { PresetName, StateVisualInput, InteractionMode } from "../state/types";

export type WsIncomingMessage =
  | { type: "setState"; state: Partial<StateVisualInput>; transitionMs?: number }
  | { type: "setPreset"; name: PresetName; intensity?: number; transitionMs?: number }
  | { type: "setInteractionMode"; mode: InteractionMode }
  | { type: "setConfig"; key: string; value: unknown };

export type WsConnectionState = "connecting" | "open" | "closed" | "error";

export interface WsClientHandlers {
  onMessage: (msg: WsIncomingMessage) => void;
  onStatus?: (status: WsConnectionState) => void;
  onError?: (error: string) => void;
}

export class WsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private handlers: WsClientHandlers;
  private closedManually = false;

  constructor(handlers: WsClientHandlers, url = APP_CONFIG.wsUrl) {
    this.url = url;
    this.handlers = handlers;
  }

  connect(): void {
    this.closedManually = false;
    this.handlers.onStatus?.("connecting");
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.handlers.onError?.(`WS 初始化失败: ${(err as Error).message}`);
      this.handlers.onStatus?.("error");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus?.("open");
    };
    this.ws.onclose = () => {
      this.handlers.onStatus?.("closed");
      if (!this.closedManually) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.handlers.onStatus?.("error");
      this.handlers.onError?.("WS 连接异常。");
    };
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsIncomingMessage;
        this.handlers.onMessage(msg);
      } catch {
        this.handlers.onError?.("WS 消息解析失败，需 JSON 协议。");
      }
    };
  }

  close(): void {
    this.closedManually = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    const timeout = Math.min(10000, 500 * Math.pow(2, this.retry));
    this.retry += 1;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = window.setTimeout(() => this.connect(), timeout);
  }
}
