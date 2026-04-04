import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppError } from "./errors";

const CONTENT_FILE = path.resolve(__dirname, "../data/landing-content.json");

export const registerLandingRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get("/api/landing/content", async () => {
    try {
      const raw = await readFile(CONTENT_FILE, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid landing-content.json");
      }
      return parsed;
    } catch (err) {
      fastify.log.error({ err }, "failed to read landing content config");
      throw new AppError(500, "LANDING_CONTENT_READ_FAILED", "Landing content config is unavailable");
    }
  });
};
