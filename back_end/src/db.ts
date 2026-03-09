import path from "node:path";
import fs from "node:fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";

let dbPromise: Promise<Database> | null = null;

const ensureDataDir = (): string => {
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};

const initialize = async (): Promise<Database> => {
  const dataDir = ensureDataDir();
  const dbPath = path.join(dataDir, "xinjin.sqlite");

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      client_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      level TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      section_scores_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS state_analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      assessment_id TEXT,
      input_text TEXT NOT NULL,
      sleep_hours REAL,
      fatigue_level INTEGER,
      social_willingness INTEGER,
      emotion_tags_json TEXT NOT NULL,
      contradictions_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      state_type TEXT NOT NULL,
      tcm_advice_json TEXT NOT NULL,
      western_advice_json TEXT NOT NULL,
      micro_tasks_json TEXT NOT NULL,
      confidence_json TEXT NOT NULL DEFAULT '{}',
      risk_notice TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assessment_id) REFERENCES assessment_records(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id_created_at
      ON sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id_created_at
      ON messages(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_assessment_user_id_created_at
      ON assessment_records(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_user_id_created_at
      ON state_analyses(user_id, created_at DESC);
  `);

  // Backward-compatible migration for old local DBs.
  const ensureColumns = async (
    table: string,
    required: Array<{ name: string; ddl: string }>
  ): Promise<void> => {
    const columns = await db.all<{ name: string }[]>(`PRAGMA table_info(${table})`);
    const existing = new Set(columns.map((c) => c.name));
    for (const col of required) {
      if (existing.has(col.name)) continue;
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.ddl}`);
    }
  };

  await ensureColumns("assessment_records", [
    { name: "score", ddl: "score INTEGER NOT NULL DEFAULT 0" },
    { name: "level", ddl: "level TEXT NOT NULL DEFAULT 'mild'" },
    { name: "answers_json", ddl: "answers_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "section_scores_json", ddl: "section_scores_json TEXT NOT NULL DEFAULT '{}'" },
    { name: "created_at", ddl: "created_at INTEGER NOT NULL DEFAULT 0" }
  ]);

  await ensureColumns("state_analyses", [
    { name: "assessment_id", ddl: "assessment_id TEXT" },
    { name: "input_text", ddl: "input_text TEXT NOT NULL DEFAULT ''" },
    { name: "sleep_hours", ddl: "sleep_hours REAL" },
    { name: "fatigue_level", ddl: "fatigue_level INTEGER" },
    { name: "social_willingness", ddl: "social_willingness INTEGER" },
    { name: "emotion_tags_json", ddl: "emotion_tags_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "contradictions_json", ddl: "contradictions_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "summary", ddl: "summary TEXT NOT NULL DEFAULT ''" },
    { name: "state_type", ddl: "state_type TEXT NOT NULL DEFAULT 'mixed_fluctuation'" },
    { name: "tcm_advice_json", ddl: "tcm_advice_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "western_advice_json", ddl: "western_advice_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "micro_tasks_json", ddl: "micro_tasks_json TEXT NOT NULL DEFAULT '[]'" },
    { name: "confidence_json", ddl: "confidence_json TEXT NOT NULL DEFAULT '{}'" },
    { name: "risk_notice", ddl: "risk_notice TEXT" },
    { name: "created_at", ddl: "created_at INTEGER NOT NULL DEFAULT 0" }
  ]);

  await ensureColumns("messages", [{ name: "client_id", ddl: "client_id TEXT" }]);
  // Keep one row per (session_id, client_id) before adding a unique index.
  await db.exec(`
    DELETE FROM messages
    WHERE client_id IS NOT NULL
      AND rowid NOT IN (
        SELECT MIN(rowid)
        FROM messages
        WHERE client_id IS NOT NULL
        GROUP BY session_id, client_id
      )
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_client_id
      ON messages(session_id, client_id)
  `);
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_session_client_id
      ON messages(session_id, client_id)
      WHERE client_id IS NOT NULL
  `);

  return db;
};

export const getDb = async (): Promise<Database> => {
  if (!dbPromise) {
    dbPromise = initialize();
  }
  return dbPromise;
};
