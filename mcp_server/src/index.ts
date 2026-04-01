import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { DifyClient } from "./dify.js";
import { adminRoutes } from "./adminRoutes.js";
import { startMcpServer } from "./mcpServer.js";

// ----------------------------------------------------------------
// Environment
// ----------------------------------------------------------------
const DIFY_BASE_URL = process.env.DIFY_BASE_URL ?? process.env.ANYTHINGLLM_BASE_URL ?? "http://localhost";
const DIFY_API_KEY = process.env.DIFY_API_KEY ?? process.env.ANYTHINGLLM_API_KEY ?? "";
const DIFY_DEFAULT_DATASET_ID =
  process.env.DIFY_DEFAULT_DATASET_ID ?? process.env.ANYTHINGLLM_WORKSPACE ?? "";
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? "4000", 10);
const MODE = (process.env.MODE ?? "both").toLowerCase();
// MODE options:
//   "mcp"   – stdio MCP server only (for direct LLM integration)
//   "admin" – HTTP admin API only
//   "both"  – HTTP admin API + MCP server on stdio (default)

if (!DIFY_API_KEY) {
  console.error("[xinjin-mcp] ERROR: DIFY_API_KEY is not set");
  process.exit(1);
}

const client = new DifyClient(DIFY_BASE_URL, DIFY_API_KEY, DIFY_DEFAULT_DATASET_ID);

// ----------------------------------------------------------------
// Admin HTTP server
// ----------------------------------------------------------------
async function startAdminServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? false,
  });

  // Multipart support for file uploads
  // Dynamically import so the package is optional when not needed
  try {
    const multipart = await import("@fastify/multipart");
    await app.register(multipart.default, { limits: { fileSize: 50 * 1024 * 1024 } });
  } catch {
    app.log.warn("@fastify/multipart not installed – /admin/documents/file endpoint disabled");
  }

  await adminRoutes(app, client);

  // Health check
  app.get("/health", async () => ({ status: "ok", service: "xinjin-dify-rag-server" }));

  await app.listen({ port: ADMIN_PORT, host: "0.0.0.0" });
  app.log.info(`Admin API listening on port ${ADMIN_PORT}`);
}

// ----------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------
(async () => {
  try {
    if (MODE === "mcp") {
      // Pure MCP stdio mode – no HTTP server
      await startMcpServer(client);
    } else if (MODE === "admin") {
      await startAdminServer();
    } else {
      // "both": run admin HTTP server and MCP stdio concurrently
      await Promise.all([startAdminServer(), startMcpServer(client)]);
    }
  } catch (err) {
    console.error("[xinjin-mcp] Fatal error:", err);
    process.exit(1);
  }
})();
