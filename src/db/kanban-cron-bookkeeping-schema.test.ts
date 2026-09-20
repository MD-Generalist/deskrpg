// 칸반·cron 장부(0011)의 SQLite 부트스트랩 검증.
// 빈 DB 는 기본 스키마만으로 갖춰지고, 0011 이전에 만들어진 DB 는 ensureSqliteCompatibility 가
// 테이블·컬럼을 더한다. 두 경로가 갈리면 한쪽 사용자만 "no such column" 을 본다.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js");
const { ensureKanbanCronBookkeeping } = require("./sqlite-kanban-cron-bookkeeping.js");
const { ensureSqliteCompatibility } = require("./server-db.js");

const NEW_TABLES = ["channel_kanban_boards", "cron_job_origins"] as const;

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function seedFixture(db: Database.Database) {
  db.prepare(
    `INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at) VALUES ('u1','u','u','x',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO channels (id, name, owner_id, created_at, updated_at) VALUES ('c1','c','u1',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO gateway_resources (id, owner_user_id, display_name, base_url, token_encrypted, created_at, updated_at) VALUES ('g1','u1','gw','http://gw','enc',datetime('now'),datetime('now'))`,
  ).run();
}

/** 0011 이전 기본 스키마 — 새 테이블 두 개와 컬럼 두 개를 걷어낸 모양. */
function legacyBaseSchema(): string {
  const stripped = SQLITE_BASE_SCHEMA.replace(/\n\s*plugin_info_json TEXT,/, "").replace(
    /\n\s*notice_json TEXT,/,
    "",
  );
  // 새 테이블 블록은 chat_room_messages 인덱스 뒤 ~ meeting_minutes 앞에 있다.
  const start = stripped.indexOf("    CREATE TABLE IF NOT EXISTS channel_kanban_boards");
  const end = stripped.indexOf("    CREATE TABLE IF NOT EXISTS meeting_minutes");
  assert.ok(start > 0 && end > start, "기본 스키마의 칸반·cron 블록 위치를 찾지 못했습니다");
  return stripped.slice(0, start) + stripped.slice(end);
}

test("빈 DB 는 기본 스키마만으로 새 테이블·컬럼을 갖춘다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  for (const t of NEW_TABLES) assert.ok(tableExists(db, t), t);
  assert.ok(columnNames(db, "gateway_resources").includes("plugin_info_json"));
  assert.ok(columnNames(db, "chat_room_messages").includes("notice_json"));
  assert.deepEqual(columnNames(db, "channel_kanban_boards"), [
    // 0017 에서 PK 가 대리 키로 옮겨지고 사건 수신 보드 표시가 더해졌다.
    "id",
    "channel_id",
    "gateway_id",
    "board_slug",
    "is_event_carrier",
    "board_name_synced_at",
    "event_cursor",
    "last_polled_at",
    "last_error",
    "created_at",
    "updated_at",
  ]);
  assert.deepEqual(columnNames(db, "cron_job_origins"), [
    "id",
    "gateway_id",
    "profile_name",
    "job_id",
    "channel_id",
    "created_by_user_id",
    "created_at",
  ]);
});

test("0011 이전 DB 는 ensureSqliteCompatibility 가 테이블·컬럼을 더한다 — 두 번 돌려도 같다", () => {
  const legacy = legacyBaseSchema();
  const db = new Database(":memory:");
  db.exec(legacy);
  for (const t of NEW_TABLES)
    assert.equal(tableExists(db, t), false, `${t} 가 미리 있으면 안 된다`);
  assert.ok(!columnNames(db, "gateway_resources").includes("plugin_info_json"));
  assert.ok(!columnNames(db, "chat_room_messages").includes("notice_json"));

  ensureSqliteCompatibility(db);
  ensureSqliteCompatibility(db);

  for (const t of NEW_TABLES) assert.ok(tableExists(db, t), t);
  assert.ok(columnNames(db, "gateway_resources").includes("plugin_info_json"));
  assert.ok(columnNames(db, "chat_room_messages").includes("notice_json"));
});

test("공용 모듈 단독으로도 멱등이고, chat_room_messages 가 없으면 그 ALTER 만 건너뛴다", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE gateway_resources (id TEXT PRIMARY KEY NOT NULL);
  `);
  ensureKanbanCronBookkeeping(db);
  ensureKanbanCronBookkeeping(db);
  for (const t of NEW_TABLES) assert.ok(tableExists(db, t), t);
  assert.ok(columnNames(db, "gateway_resources").includes("plugin_info_json"));
  assert.equal(tableExists(db, "chat_room_messages"), false);
});

test("cron_job_origins 는 (gateway_id, profile_name, job_id) 가 유니크다", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_BASE_SCHEMA);
  seedFixture(db);
  const insert = db.prepare(
    `INSERT INTO cron_job_origins (id, gateway_id, profile_name, job_id, channel_id, created_by_user_id, created_at)
     VALUES (?, 'g1', ?, ?, 'c1', 'u1', datetime('now'))`,
  );
  insert.run("o1", "sophie", "job-a");
  insert.run("o2", "sophie", "job-b"); // job 이 다르면 된다
  insert.run("o3", "other", "job-a"); // 프로필이 다르면 된다
  assert.throws(
    () => insert.run("o4", "sophie", "job-a"),
    /UNIQUE constraint failed/,
    "같은 (gateway, profile, job) 은 두 번 등록되면 안 된다",
  );
});

test("채널을 지우면 보드 연결과 cron 출처가 cascade 로 사라진다", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_BASE_SCHEMA);
  seedFixture(db);
  db.prepare(
    `INSERT INTO channel_kanban_boards (id, channel_id, gateway_id, board_slug, created_at, updated_at) VALUES ('b1','c1','g1','board',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO cron_job_origins (id, gateway_id, profile_name, job_id, channel_id, created_by_user_id, created_at) VALUES ('o1','g1','sophie','job-a','c1','u1',datetime('now'))`,
  ).run();

  db.prepare(`DELETE FROM channels WHERE id='c1'`).run();
  assert.equal(
    (db.prepare(`SELECT count(*) AS n FROM channel_kanban_boards`).get() as { n: number }).n,
    0,
  );
  assert.equal(
    (db.prepare(`SELECT count(*) AS n FROM cron_job_origins`).get() as { n: number }).n,
    0,
  );
});
