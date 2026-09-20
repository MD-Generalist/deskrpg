// 승인 레코드(0016)의 SQLite 부트스트랩 검증.
// 빈 DB 는 기본 스키마만으로 갖춰지고, 이 변경 이전에 만들어진 DB 는 같은 기본 스키마를 다시
// 태워 테이블이 더해진다(`CREATE TABLE IF NOT EXISTS`). 두 경로가 갈리면 한쪽 사용자만
// "no such table: approvals" 를 본다.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js");

const NEW_TABLES = ["approvals", "approval_targets"] as const;

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

/** 이 변경 이전 기본 스키마 — 새 테이블 블록을 걷어낸 모양. */
function legacyBaseSchema(): string {
  const start = SQLITE_BASE_SCHEMA.indexOf("    CREATE TABLE IF NOT EXISTS approvals (");
  const end = SQLITE_BASE_SCHEMA.indexOf("    CREATE TABLE IF NOT EXISTS meeting_minutes");
  assert.ok(start > 0 && end > start, "기본 스키마의 승인 블록 위치를 찾지 못했습니다");
  return SQLITE_BASE_SCHEMA.slice(0, start) + SQLITE_BASE_SCHEMA.slice(end);
}

test("빈 DB 는 기본 스키마만으로 승인 테이블을 갖춘다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  for (const t of NEW_TABLES) assert.ok(tableExists(db, t), t);
  db.close();
});

test("이 변경 이전 DB 도 기본 스키마를 다시 태우면 테이블이 더해진다", () => {
  const db = new Database(":memory:");
  db.exec(legacyBaseSchema());
  for (const t of NEW_TABLES)
    assert.equal(tableExists(db, t), false, `${t} 가 미리 있으면 안 된다`);
  db.exec(SQLITE_BASE_SCHEMA);
  for (const t of NEW_TABLES) assert.ok(tableExists(db, t), t);
  db.close();
});

test("기존 행이 있는 DB 에 다시 태워도 데이터가 남는다", () => {
  const db = new Database(":memory:");
  db.exec(legacyBaseSchema());
  db.prepare(
    `INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at)
     VALUES ('u1','u','u','x',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO channels (id, name, owner_id, created_at, updated_at)
     VALUES ('c1','c','u1',datetime('now'),datetime('now'))`,
  ).run();
  db.exec(SQLITE_BASE_SCHEMA);
  assert.equal(
    (db.prepare(`SELECT count(*) AS n FROM channels`).get() as { n: number }).n,
    1,
    "재실행이 기존 데이터를 지우면 안 된다",
  );
  db.close();
});

test("승인 1건에 카드 N개가 달리고, 대상 0행도 허용된다", () => {
  // 덩어리 1 의 '프로젝트로 등록할까요?' 는 대상이 카드가 아니라 0행으로 들어온다.
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  db.prepare(
    `INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at)
     VALUES ('u1','u','u','x',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO channels (id, name, owner_id, created_at, updated_at)
     VALUES ('c1','c','u1',datetime('now'),datetime('now'))`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO approvals (id, channel_id, type, status, requested_by, title, source_json, created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))`,
  );
  insert.run(
    "a1",
    "c1",
    "task_execution",
    "pending",
    "sophie",
    "7건 수행할까요?",
    '{"kind":"meeting","id":"m1"}',
  );
  insert.run(
    "a2",
    "c1",
    "project_registration",
    "pending",
    "sophie",
    "프로젝트로 등록할까요?",
    '{"kind":"meeting","id":"m1"}',
  );
  const target = db.prepare(`INSERT INTO approval_targets (approval_id, task_id) VALUES (?,?)`);
  target.run("a1", "task-1");
  target.run("a1", "task-2");
  assert.equal(
    (
      db.prepare(`SELECT count(*) AS n FROM approval_targets WHERE approval_id='a1'`).get() as {
        n: number;
      }
    ).n,
    2,
  );
  assert.equal(
    (
      db.prepare(`SELECT count(*) AS n FROM approval_targets WHERE approval_id='a2'`).get() as {
        n: number;
      }
    ).n,
    0,
    "대상 없는 type 도 공존한다",
  );
  db.close();
});

test("승인을 지우면 대상도 함께 지워진다", () => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SQLITE_BASE_SCHEMA);
  db.prepare(
    `INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at)
     VALUES ('u1','u','u','x',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO channels (id, name, owner_id, created_at, updated_at)
     VALUES ('c1','c','u1',datetime('now'),datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO approvals (id, channel_id, type, status, requested_by, title, source_json, created_at)
     VALUES ('a1','c1','task_execution','pending','sophie','t','{}',datetime('now'))`,
  ).run();
  db.prepare(`INSERT INTO approval_targets (approval_id, task_id) VALUES ('a1','task-1')`).run();
  db.prepare(`DELETE FROM approvals WHERE id='a1'`).run();
  assert.equal(
    (db.prepare(`SELECT count(*) AS n FROM approval_targets`).get() as { n: number }).n,
    0,
  );
  db.close();
});
