import { APP_CONFIG } from "../config";
import { PresetName, StateVisualInput, InteractionMode } from "../state/types";

// 服务端 -> 前端的 WS 消息协议。
export type WsIncomingMessage =
  | { type: "setState"; state: Partial<StateVisualInput>; transitionMs?: number }
  | { type: "setPreset"; name: PresetName; intensity?: number; transitionMs?: number }
  | { type: "setInteractionMode"; mode: InteractionMode }
  | { type: "setConfig"; key: string; value: unknown };

// 连接状态（可用于 UI 状态灯）。
export type WsConnectionState = "connecting" | "open" | "closed" | "error";

export interface WsClientHandlers {
  // 收到业务消息时触发。
  onMessage: (msg: WsIncomingMessage) => void;
  // 连接状态变化时触发。
  onStatus?: (status: WsConnectionState) => void;
  // 错误消息回调。
  onError?: (error: string) => void;
}

// WebSocket 客户端：含自动重连（指数退避）。
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

  // 建立连接。若失败会进入重连流程。
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

  // 手动关闭：会阻止后续自动重连。
  close(): void {
    this.closedManually = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  // 指数退避重连：500ms, 1000ms, 2000ms ... 最大 10s。
  private scheduleReconnect(): void {
    const timeout = Math.min(10000, 500 * Math.pow(2, this.retry));
    this.retry += 1;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = window.setTimeout(() => this.connect(), timeout);
  }
}
