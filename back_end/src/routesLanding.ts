import type { FastifyInstance } from "fastify";
import { getDb } from "./db";

type CounterRow = {
  value: number;
};

const COUNTER_KEY = "landing_visits";
const BASE_VISIT_COUNT = 1120;

const ensureCounter = async (): Promise<void> => {
  const db = await getDb();
  await db.run(
    `
      INSERT INTO site_counters (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `,
    COUNTER_KEY,
    BASE_VISIT_COUNT,
    Date.now()
  );
};

const readCounter = async (): Promise<number> => {
  const db = await getDb();
  const row = await db.get<CounterRow>("SELECT value FROM site_counters WHERE key = ?", COUNTER_KEY);
  return row?.value ?? BASE_VISIT_COUNT;
};

export const registerLandingRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get("/api/landing/visits", async () => {
    await ensureCounter();
    const count = await readCounter();
    return { count };
  });

  fastify.post("/api/landing/visits/increment", async () => {
    await ensureCounter();
    const db = await getDb();
    await db.run("UPDATE site_counters SET value = value + 1, updated_at = ? WHERE key = ?", Date.now(), COUNTER_KEY);
    const count = await readCounter();
    return { count };
  });
};
