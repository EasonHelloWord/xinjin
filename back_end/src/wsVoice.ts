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
        text: "（语音转文本占位）我现在有点累"
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
