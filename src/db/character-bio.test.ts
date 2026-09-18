// src/db/character-bio.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";

import { ensureSqliteCompatibility } from "./index";
const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js") as { SQLITE_BASE_SCHEMA: string };

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("빈 SQLite 부팅에 characters.bio 가 있다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  ensureSqliteCompatibility(db);
  assert.ok(columns(db, "characters").includes("bio"));
});

test("bio 가 없는 기존 SQLite 도 부팅하면 bio 가 생긴다", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL UNIQUE);
    CREATE TABLE characters (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, appearance TEXT NOT NULL, created_at TEXT, updated_at TEXT);`);
  ensureSqliteCompatibility(db);
  assert.ok(columns(db, "characters").includes("bio"));
  // 두 번 불러도 깨지지 않는다(멱등).
  ensureSqliteCompatibility(db);
});
