// src/db/channel-motion-config-schema.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { ensureSqliteCompatibility } from "./index";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js") as { SQLITE_BASE_SCHEMA: string };
const serverDb = require("./server-db.js") as { ensureSqliteCompatibility?: (db: unknown) => void };

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("빈 SQLite 부팅에 channels.motion_config 가 있다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  ensureSqliteCompatibility(db);
  assert.ok(columns(db, "channels").includes("motion_config"));
});

test("컬럼이 없는 기존 SQLite 도 부팅하면 motion_config 가 비어 있는 채로 생긴다 — 두 부팅 경로 모두", () => {
  for (const ensure of [ensureSqliteCompatibility, serverDb.ensureSqliteCompatibility]) {
    if (!ensure) continue;
    const db = new Database(":memory:");
    db.exec(SQLITE_BASE_SCHEMA.replace(/\s*motion_config TEXT,/, ""));
    assert.ok(!columns(db, "channels").includes("motion_config"), "사전 조건: 옛 스키마");
    db.pragma("foreign_keys = OFF"); // 채널 행 하나만 두려는 것 — 주인 사용자까지 만들 필요는 없다.
    db.prepare("INSERT INTO channels (id, name, owner_id) VALUES ('c1','채널','u1')").run();
    ensure(db);
    assert.ok(columns(db, "channels").includes("motion_config"));
    const row = db.prepare("SELECT motion_config AS m FROM channels WHERE id = 'c1'").get() as {
      m: string | null;
    };
    assert.equal(row.m, null, "기존 채널은 비어 있어야 한다 — 비어 있으면 기본값이다");
    ensure(db); // 두 번 불러도 깨지지 않는다(멱등).
  }
});

test("PG 마이그레이션은 다시 돌려도 깨지지 않는다(IF NOT EXISTS)", () => {
  const sql = readFileSync(
    new URL("../../drizzle/0020_channel_motion_config.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "motion_config" jsonb/);
  assert.doesNotMatch(sql, /DROP|RENAME/i, "추가만 한다");
});
