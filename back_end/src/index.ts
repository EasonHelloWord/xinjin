import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { registerMainWs } from "./wsMain";
import { registerVoiceWs } from "./wsVoice";

const createServer = async () => {
  const fastify = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard"
              }
            }
    }
  });

  await fastify.register(websocket);
  await registerMainWs(fastify);
  await registerVoiceWs(fastify);

  return fastify;
};

const start = async (): Promise<void> => {
  const app = await createServer();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: 8787
    });
    app.log.info("xinjin backend listening on ws://localhost:8787 and ws://localhost:8787/voice");
  } catch (err) {
    app.log.error({ err }, "failed to start server");
    process.exit(1);
  }
};

void start();
