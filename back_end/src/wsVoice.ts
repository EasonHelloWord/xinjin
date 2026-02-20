import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ServerMessage } from "./protocol";
import { nowTs } from "./utils";

type VoicePayload = Record<string, unknown>;

const send = <TPayload extends VoicePayload>(socket: WebSocket, type: string, payload: TPayload): void => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: ServerMessage<TPayload> = {
    v: 1,
    type,
    ts: nowTs(),
    payload
  };
  socket.send(JSON.stringify(message));
};

export const registerVoiceWs = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get("/voice", { websocket: true }, (socket) => {
    send(socket, "voice_ready", {
      mode: "placeholder"
    });

    socket.on("message", () => {
      // Placeholder path: acknowledge every packet and return a fake transcript.
      send(socket, "voice_transcript", {
        text: "\uff08\u8bed\u97f3\u8f6c\u6587\u672c\u5360\u4f4d\uff09\u6211\u73b0\u5728\u6709\u70b9\u7d2f\u3002"
      });
      send(socket, "suggested_preset", {
        name: "tired"
      });
    });

    socket.on("error", (err: Error) => {
      fastify.log.error({ err }, "Voice websocket error");
      send(socket, "error", {
        code: "INTERNAL",
        message: "Voice channel internal error"
      });
    });
  });
};
