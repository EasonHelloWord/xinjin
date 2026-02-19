import type { FastifyInstance } from "fastify";
import type { RawData } from "ws";
import type { WebSocket } from "ws";
import { mockBrain } from "./mockBrain";
import { clampState, normalizeIntensity, parseMessage, ServerMessage, State } from "./protocol";
import { sessionStore } from "./sessionStore";
import { createSessionId, nowTs, toText } from "./utils";

type EnvelopePayload = Record<string, unknown>;

const HEARTBEAT_MS = 25_000;

export const registerMainWs = async (fastify: FastifyInstance): Promise<void> => {
  const connections = new Map<WebSocket, string>();
  const liveness = new Map<WebSocket, boolean>();

  const send = <TPayload extends EnvelopePayload>(
    socket: WebSocket,
    type: string,
    payload: TPayload,
    reqId?: string
  ): void => {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    const message: ServerMessage<TPayload> = {
      v: 1,
      type,
      ts: nowTs(),
      payload
    };
    if (reqId) {
      message.reqId = reqId;
    }
    socket.send(JSON.stringify(message));
  };

  const sendError = (socket: WebSocket, code: string, message: string, reqId?: string): void => {
    send(socket, "error", { code, message, reqId }, reqId);
  };

  const sendHelloAck = (socket: WebSocket, sessionId: string): void => {
    send(socket, "hello_ack", {
      back_end: "xinjin-backend",
      version: "1.0",
      sessionId
    });
  };

  const cleanup = (socket: WebSocket): void => {
    connections.delete(socket);
    liveness.delete(socket);
  };

  const applyStateEcho = (
    socket: WebSocket,
    sessionId: string,
    patch: Partial<State>,
    transitionMs?: number,
    reqId?: string
  ): void => {
    const clamped = clampState(patch);
    sessionStore.patchState(sessionId, clamped);
    send(
      socket,
      "set_state",
      {
        state: clamped,
        transitionMs
      },
      reqId
    );
  };

  const heartbeat = setInterval(() => {
    for (const socket of connections.keys()) {
      if (socket.readyState !== socket.OPEN) {
        cleanup(socket);
        continue;
      }
      if (liveness.get(socket) === false) {
        socket.terminate();
        cleanup(socket);
        continue;
      }
      liveness.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);

  fastify.addHook("onClose", async () => {
    clearInterval(heartbeat);
    for (const socket of connections.keys()) {
      try {
        socket.close();
      } catch {
        // ignore shutdown race
      }
    }
    connections.clear();
    liveness.clear();
  });

  fastify.get("/", { websocket: true }, (socket) => {
    const sessionId = createSessionId();
    sessionStore.get(sessionId);

    connections.set(socket, sessionId);
    liveness.set(socket, true);
    sendHelloAck(socket, sessionId);

    socket.on("pong", () => {
      liveness.set(socket, true);
    });

    socket.on("close", () => {
      cleanup(socket);
    });

    socket.on("error", (err: Error) => {
      fastify.log.error({ err }, "Main websocket error");
      sendError(socket, "INTERNAL", "Unexpected websocket error");
      cleanup(socket);
    });

    socket.on("message", (raw: RawData) => {
      const text = toText(raw);
      const parsed = parseMessage(text);

      if (!parsed.ok) {
        sendError(socket, "BAD_MESSAGE", parsed.error);
        return;
      }

      const message = parsed.data;
      const sid = connections.get(socket) ?? sessionId;

      try {
        switch (message.type) {
          case "hello":
            sendHelloAck(socket, sid);
            break;

          case "text_input": {
            const existing = sessionStore.get(sid);
            const result = mockBrain(message.payload.text, existing.state);

            send(
              socket,
              "system_response",
              {
                text: result.replyText,
                suggestedPreset: result.suggestedPreset
              },
              message.reqId
            );

            sessionStore.setPreset(sid, result.suggestedPreset);
            send(
              socket,
              "set_preset",
              {
                name: result.suggestedPreset
              },
              message.reqId
            );

            applyStateEcho(socket, sid, result.statePatch, 400, message.reqId);
            break;
          }

          case "set_state":
            applyStateEcho(
              socket,
              sid,
              message.payload.state,
              message.payload.transitionMs,
              message.reqId
            );
            break;

          case "set_preset": {
            const intensity = normalizeIntensity(message.payload.intensity);
            sessionStore.setPreset(sid, message.payload.name);
            send(
              socket,
              "set_preset",
              {
                name: message.payload.name,
                intensity,
                transitionMs: message.payload.transitionMs
              },
              message.reqId
            );
            break;
          }

          default:
            sendError(socket, "BAD_MESSAGE", "Unsupported message type");
            break;
        }
      } catch (err) {
        fastify.log.error({ err }, "Main websocket handler failure");
        sendError(socket, "INTERNAL", "Internal server error", message.reqId);
      }
    });
  });
};
