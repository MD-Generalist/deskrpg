// 2026-04 태스크 시스템 폐기(0012)의 SQLite 쪽 검증.
// 옛 tasks / npc_reports 가 남아 있는 기존 DB 를 열면 두 부트스트랩 모두 테이블을 지우고,
// 빈 DB 에는 애초에 만들지 않는다. 사용자가 이관 없이 폐기하기로 했으므로 데이터는 복구되지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js");
const { LEGACY_TASK_TABLES, dropLegacyTaskTables } = require("./sqlite-legacy-tasks-drop.js");
const { ensureSqliteCompatibility } = require("./server-db.js");

// 0011 까지의 기본 스키마에 들어 있던 정의 그대로(npc_reports → tasks FK 포함).
const LEGACY_TASK_DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    npc_id TEXT REFERENCES npcs(id) ON DELETE CASCADE,
    assigner_id TEXT NOT NULL REFERENCES characters(id),
    npc_task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel_id);
  CREATE TABLE IF NOT EXISTS npc_reports (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`;

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

test("빈 DB 의 기본 스키마에는 tasks / npc_reports 가 없다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  for (const t of LEGACY_TASK_TABLES) assert.equal(tableExists(db, t), false, t);
});

test("옛 테이블이 남은 기존 DB 는 ensureSqliteCompatibility 가 지운다 — 두 번 돌려도 같다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  db.exec(LEGACY_TASK_DDL);
  for (const t of LEGACY_TASK_TABLES) assert.ok(tableExists(db, t), `${t} 가 미리 있어야 한다`);

  ensureSqliteCompatibility(db);
  ensureSqliteCompatibility(db);

  for (const t of LEGACY_TASK_TABLES)
    assert.equal(tableExists(db, t), false, `${t} 는 지워져야 한다`);
  // 다른 테이블은 건드리지 않는다.
  for (const t of ["npcs", "channels", "channel_kanban_boards", "meeting_minutes"]) {
    assert.ok(tableExists(db, t), t);
  }
});

test("공용 모듈 단독으로도 멱등이고, 테이블이 없어도 오류가 없다", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);`);
  db.exec(LEGACY_TASK_DDL);
  dropLegacyTaskTables(db);
  dropLegacyTaskTables(db);
  for (const t of LEGACY_TASK_TABLES) assert.equal(tableExists(db, t), false, t);
  assert.ok(tableExists(db, "users"));
});
