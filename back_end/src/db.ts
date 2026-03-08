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
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      level TEXT NOT NULL,
      answers_json TEXT NOT NULL,
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

  return db;
};

export const getDb = async (): Promise<Database> => {
  if (!dbPromise) {
    dbPromise = initialize();
  }
  return dbPromise;
};
