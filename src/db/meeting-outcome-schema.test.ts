import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";

import { ensureSqliteCompatibility } from "./index";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js") as { SQLITE_BASE_SCHEMA: string };

function columns(db: Database.Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
}

test("빈 SQLite 부팅에 회의 결과 컬럼이 있다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  ensureSqliteCompatibility(db);
  const cols = columns(db, "meeting_minutes");
  const outcome = cols.find((c) => c.name === "outcome_json");
  const status = cols.find((c) => c.name === "summary_status");
  assert.equal(outcome?.notnull, 0);
  assert.equal(status?.notnull, 1);
  assert.equal(status?.dflt_value, "'ok'");
});

test("컬럼이 없는 기존 회의록도 부팅하면 생기고, 옛 행은 ok 로 읽힌다", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE meeting_minutes (id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL,
      topic TEXT NOT NULL, transcript TEXT NOT NULL, participants TEXT NOT NULL DEFAULT '[]',
      total_turns INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER, initiator_id TEXT,
      key_topics TEXT NOT NULL DEFAULT '[]', conclusions TEXT, created_at TEXT NOT NULL);
    INSERT INTO meeting_minutes (id, channel_id, topic, transcript, created_at)
      VALUES ('m1', 'c1', '주제', '전문', '2026-09-01T00:00:00.000Z');`);
  ensureSqliteCompatibility(db);
  const row = db
    .prepare("SELECT outcome_json, summary_status FROM meeting_minutes WHERE id = 'm1'")
    .get() as { outcome_json: string | null; summary_status: string };
  assert.deepEqual(row, { outcome_json: null, summary_status: "ok" });
  // 두 번 불러도 깨지지 않는다(멱등).
  ensureSqliteCompatibility(db);
});
