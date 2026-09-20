"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const { resetSqliteUserPassword } = require("./cli-reset-password.js");

function seedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, system_role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT);`);
  db.prepare(
    "INSERT INTO users (id, login_id, nickname, password_hash) VALUES ('u1','dante','단테','old-hash')",
  ).run();
  return db;
}

test("로그인 ID 로 해시를 바꾸고 강제 변경 표시를 세운다", async () => {
  const db = seedDb();
  const passwordHash = await bcrypt.hash("temporary-password", 10);

  const result = resetSqliteUserPassword(db, "dante", passwordHash);

  assert.deepEqual(result, { id: "u1", loginId: "dante", nickname: "단테" });
  const row = db
    .prepare("SELECT password_hash, must_change_password FROM users WHERE id='u1'")
    .get();
  assert.equal(row.password_hash, passwordHash);
  assert.equal(row.must_change_password, 1);
  db.close();
});

test("없는 로그인 ID 는 null 을 돌려주고 아무 행도 건드리지 않는다", () => {
  const db = seedDb();

  const result = resetSqliteUserPassword(db, "nobody", "new-hash");

  assert.equal(result, null);
  const row = db.prepare("SELECT password_hash FROM users WHERE id='u1'").get();
  assert.equal(row.password_hash, "old-hash");
  db.close();
});

test("must_change_password 컬럼이 없는 옛 DB 에서는 안내와 함께 실패한다", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);`);
  db.prepare(
    "INSERT INTO users (id, login_id, nickname, password_hash) VALUES ('u1','dante','단테','old-hash')",
  ).run();

  assert.throws(() => resetSqliteUserPassword(db, "dante", "new-hash"), /deskrpg start/);
  db.close();
});
