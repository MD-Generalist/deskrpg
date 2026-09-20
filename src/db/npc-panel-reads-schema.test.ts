// npc_panel_reads(0019)의 SQLite 부트스트랩 검증.
// 빈 DB 는 기본 스키마만으로 갖춰지고, 0019 이전에 만들어진 DB 는 ensureSqliteCompatibility 가
// 테이블을 더한다. 두 경로가 갈리면 한쪽 사용자만 "no such table" 을 본다.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js");
const { ensureNpcPanelReads } = require("./sqlite-npc-panel-reads.js");
const { ensureSqliteCompatibility } = require("./server-db.js");

const EXPECTED_COLUMNS = ["user_id", "npc_id", "tab", "seen_at", "seen_ids"];

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
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
  db.prepare(
    `INSERT INTO hermes_profiles (id, gateway_id, profile_name, token_encrypted, created_at, updated_at) VALUES ('p1','g1','sophie','enc',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO npcs (id, channel_id, hermes_profile_id, position_x, position_y, created_at, updated_at) VALUES ('n1','c1','p1',0,0,datetime('now'),datetime('now'))`,
  ).run();
}

/** 0019 이전 기본 스키마 — npc_panel_reads 블록을 걷어낸 모양. */
function legacyBaseSchema(): string {
  const start = SQLITE_BASE_SCHEMA.indexOf("    CREATE TABLE IF NOT EXISTS npc_panel_reads");
  const end = SQLITE_BASE_SCHEMA.indexOf("    CREATE TABLE IF NOT EXISTS meeting_minutes");
  assert.ok(start > 0 && end > start, "기본 스키마의 npc_panel_reads 블록 위치를 찾지 못했습니다");
  return SQLITE_BASE_SCHEMA.slice(0, start) + SQLITE_BASE_SCHEMA.slice(end);
}

test("빈 DB 는 기본 스키마만으로 npc_panel_reads 를 갖춘다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  assert.ok(tableExists(db, "npc_panel_reads"));
  assert.deepEqual(columnNames(db, "npc_panel_reads"), EXPECTED_COLUMNS);
  assert.deepEqual(primaryKeyColumns(db, "npc_panel_reads"), ["user_id", "npc_id", "tab"]);
});

test("0019 이전 DB 는 ensureSqliteCompatibility 가 테이블을 더한다 — 두 번 돌려도 같다", () => {
  const db = new Database(":memory:");
  db.exec(legacyBaseSchema());
  assert.equal(tableExists(db, "npc_panel_reads"), false, "npc_panel_reads 가 미리 있으면 안 된다");

  ensureSqliteCompatibility(db);
  ensureSqliteCompatibility(db);

  assert.ok(tableExists(db, "npc_panel_reads"));
  assert.deepEqual(columnNames(db, "npc_panel_reads"), EXPECTED_COLUMNS);
  assert.deepEqual(primaryKeyColumns(db, "npc_panel_reads"), ["user_id", "npc_id", "tab"]);
});

test("공용 모듈 단독으로도 멱등이다", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE npcs (id TEXT PRIMARY KEY NOT NULL);
  `);
  ensureNpcPanelReads(db);
  ensureNpcPanelReads(db);
  assert.ok(tableExists(db, "npc_panel_reads"));
});

test("(user_id, npc_id, tab) 가 복합 기본키다", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_BASE_SCHEMA);
  seedFixture(db);
  const insert = db.prepare(
    `INSERT INTO npc_panel_reads (user_id, npc_id, tab, seen_at, seen_ids) VALUES ('u1','n1',?,datetime('now'),?)`,
  );
  insert.run("cron", null); // cron 행은 seen_ids 가 NULL
  insert.run("cards", '["t1"]'); // 탭이 다르면 된다
  assert.throws(
    () => insert.run("cron", null),
    /UNIQUE constraint failed/,
    "같은 (user, npc, tab) 은 두 번 들어가면 안 된다",
  );
});

test("사용자·직원을 지우면 열람 상태가 cascade 로 사라진다", () => {
  // u1 은 채널 소유자라 지울 수 없다(channels.owner_id 가 막는다) — 열람만 남긴 u2 로 확인한다.
  for (const [what, sql] of [
    ["users", `DELETE FROM users WHERE id='u2'`],
    ["npcs", `DELETE FROM npcs WHERE id='n1'`],
  ] as const) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(SQLITE_BASE_SCHEMA);
    seedFixture(db);
    db.prepare(
      `INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at) VALUES ('u2','u2','u2','x',datetime('now'),datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO npc_panel_reads (user_id, npc_id, tab, seen_at) VALUES ('u2','n1','cards',datetime('now'))`,
    ).run();
    db.prepare(sql).run();
    assert.equal(
      (db.prepare(`SELECT count(*) AS n FROM npc_panel_reads`).get() as { n: number }).n,
      0,
      `${what} 삭제가 cascade 되지 않았습니다`,
    );
  }
});
