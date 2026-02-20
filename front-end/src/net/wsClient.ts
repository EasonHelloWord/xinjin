import { APP_CONFIG } from "../config";
import { InteractionMode, PresetName, StateVisualInput } from "../state/types";

type WsEnvelope<TPayload = Record<string, unknown>> = {
  v?: number;
  type: string;
  ts?: number;
  reqId?: string;
  payload?: TPayload;
};

export type WsIncomingMessage =
  | { type: "setState"; state: Partial<StateVisualInput>; transitionMs?: number }
  | { type: "setPreset"; name: PresetName; intensity?: number; transitionMs?: number }
  | { type: "setInteractionMode"; mode: InteractionMode }
  | { type: "setConfig"; key: string; value: unknown }
  | { type: "hello_ack"; sessionId: string }
  | { type: "system_response"; text: string; suggestedPreset?: PresetName }
  | { type: "set_state"; state: Partial<StateVisualInput>; transitionMs?: number }
  | { type: "set_preset"; name: PresetName; intensity?: number; transitionMs?: number }
  | { type: "error"; code: string; message: string };

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

  send(type: string, payload: Record<string, unknown>, reqId?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    const message: WsEnvelope<Record<string, unknown>> = {
      v: 1,
      type,
      ts: Date.now(),
      payload
    };

    if (reqId) {
      message.reqId = reqId;
    }

    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendTextInput(text: string, sessionId?: string): boolean {
    const payload: Record<string, unknown> = { text };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return this.send("text_input", payload);
  }

  connect(): void {
    this.closedManually = false;
    this.handlers.onStatus?.("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.handlers.onError?.(`WS initialization failed: ${(err as Error).message}`);
      this.handlers.onStatus?.("error");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus?.("open");
      this.send("hello", { client: "front-end", version: "1.0.0" });
    };

    this.ws.onclose = () => {
      this.handlers.onStatus?.("closed");
      if (!this.closedManually) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.handlers.onStatus?.("error");
      this.handlers.onError?.("WS connection error.");
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data) as WsIncomingMessage | WsEnvelope<Record<string, unknown>>;
        if (this.isEnvelope(raw)) {
          const normalized = this.normalizeEnvelope(raw);
          if (normalized) {
            this.handlers.onMessage(normalized);
          }
          return;
        }
        this.handlers.onMessage(raw);
      } catch {
        this.handlers.onError?.("WS message parse failed. Expected JSON.");
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

  private isEnvelope(value: unknown): value is WsEnvelope<Record<string, unknown>> {
    return !!value && typeof value === "object" && "type" in value && "payload" in value;
  }

  private normalizeEnvelope(envelope: WsEnvelope<Record<string, unknown>>): WsIncomingMessage | null {
    const payload = envelope.payload ?? {};

    switch (envelope.type) {
      case "hello_ack":
        if (typeof payload.sessionId === "string") {
          return { type: "hello_ack", sessionId: payload.sessionId };
        }
        return null;

      case "system_response":
        if (typeof payload.text === "string") {
          return {
            type: "system_response",
            text: payload.text,
            suggestedPreset:
              typeof payload.suggestedPreset === "string"
                ? (payload.suggestedPreset as PresetName)
                : undefined
          };
        }
        return null;

      case "set_state":
        if (payload.state && typeof payload.state === "object") {
          return {
            type: "set_state",
            state: payload.state as Partial<StateVisualInput>,
            transitionMs: typeof payload.transitionMs === "number" ? payload.transitionMs : undefined
          };
        }
        return null;

      case "set_preset":
        if (typeof payload.name === "string") {
          return {
            type: "set_preset",
            name: payload.name as PresetName,
            intensity: typeof payload.intensity === "number" ? payload.intensity : undefined,
            transitionMs: typeof payload.transitionMs === "number" ? payload.transitionMs : undefined
          };
        }
        return null;

      case "error":
        if (typeof payload.code === "string" && typeof payload.message === "string") {
          return {
            type: "error",
            code: payload.code,
            message: payload.message
          };
        }
        return null;

      default:
        return null;
    }
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
