import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { getDb } from "./db";
import { AppError } from "./errors";
import { registerAuthRoutes } from "./routesAuth";
import { registerChatRoutes } from "./routesChat";
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

  await getDb();
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });

  fastify.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: unknown; code?: string; message?: string };

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: error.issues.map((issue) => issue.message).join("; ")
        }
      });
      return;
    }

    if (typeof err.statusCode === "number") {
      reply.status(err.statusCode).send({
        error: {
          code: err.code ?? "BAD_REQUEST",
          message: err.message || "Request error"
        }
      });
      return;
    }

    fastify.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({
      error: {
        code: "INTERNAL",
        message: "Internal server error"
      }
    });
  });

  await registerAuthRoutes(fastify);
  await registerChatRoutes(fastify);
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
