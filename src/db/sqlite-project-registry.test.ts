// 프로젝트 목록표(0017)의 SQLite 쪽 검증.
//
// 가장 중요한 것은 **이관에서 행과 커서가 살아남는가**다. `event_cursor` 를 잃으면 그 채널이
// 사건을 한 구간 통째로 놓치고, 그것은 조용한 실패로 나타난다(화면은 멀쩡하고 카드만 안 움직인다).
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ensureProjectRegistry } = require("./sqlite-project-registry.js");

// better-sqlite3 는 외래 키를 켠 채로 연다. 참조 대상이 없으면 INSERT 가 FK 오류로 막혀
// 정작 보려던 유니크 제약을 못 본다 — 그래서 최소한의 스텁을 세운다.
const REFERENCED_STUBS = `
  CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE gateway_resources (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE npcs (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE meeting_minutes (id TEXT PRIMARY KEY NOT NULL);
  INSERT INTO channels (id) VALUES ('chan-1'), ('chan-2');
  INSERT INTO gateway_resources (id) VALUES ('gw-1'), ('gw-2');
`;

/** 0016 까지의 모양 — channel_id 가 PK 이고 id·is_event_carrier 가 없다. */
const LEGACY_BOARDS_DDL = `
  CREATE TABLE channel_kanban_boards (
    channel_id TEXT PRIMARY KEY NOT NULL,
    gateway_id TEXT NOT NULL,
    board_slug TEXT NOT NULL,
    board_name_synced_at TEXT,
    event_cursor TEXT,
    last_polled_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_channel_kanban_boards_gateway_id ON channel_kanban_boards(gateway_id);
`;

type Row = Record<string, unknown>;

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => String(c.name));
}

function legacyDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(REFERENCED_STUBS);
  db.exec(LEGACY_BOARDS_DDL);
  const insert = db.prepare(`
    INSERT INTO channel_kanban_boards
      (channel_id, gateway_id, board_slug, board_name_synced_at, event_cursor, last_polled_at, last_error, created_at, updated_at)
    VALUES (@channel_id, @gateway_id, @board_slug, @synced, @cursor, @polled, @error, @created, @updated)`);
  insert.run({
    channel_id: "chan-1",
    gateway_id: "gw-1",
    board_slug: "deskrpg-aaa",
    synced: "2026-09-01T00:00:00.000Z",
    cursor: "CURSOR-A",
    polled: "2026-09-02T00:00:00.000Z",
    error: null,
    created: "2026-08-01T00:00:00.000Z",
    updated: "2026-09-02T00:00:00.000Z",
  });
  insert.run({
    channel_id: "chan-2",
    gateway_id: "gw-2",
    board_slug: "deskrpg-bbb",
    synced: null,
    cursor: null,
    polled: null,
    error: "plugin_absent",
    created: "2026-08-05T00:00:00.000Z",
    updated: "2026-08-05T00:00:00.000Z",
  });
  return db;
}

test("이관은 행과 event_cursor 를 그대로 옮긴다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);

  const rows = db.prepare("SELECT * FROM channel_kanban_boards ORDER BY channel_id").all() as Row[];
  assert.equal(rows.length, 2, "행이 사라졌습니다");

  assert.equal(rows[0].channel_id, "chan-1");
  assert.equal(rows[0].board_slug, "deskrpg-aaa");
  assert.equal(rows[0].event_cursor, "CURSOR-A", "커서를 잃으면 사건을 한 구간 놓칩니다");
  assert.equal(rows[0].board_name_synced_at, "2026-09-01T00:00:00.000Z");
  assert.equal(rows[0].created_at, "2026-08-01T00:00:00.000Z");

  assert.equal(rows[1].channel_id, "chan-2");
  assert.equal(rows[1].event_cursor, null);
  assert.equal(rows[1].last_error, "plugin_absent");
});

test("이관된 행은 전부 사건 수신 보드다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  const rows = db.prepare("SELECT id, is_event_carrier FROM channel_kanban_boards").all() as Row[];
  for (const row of rows) {
    assert.equal(row.is_event_carrier, 1, "이관 전 유일한 보드는 이미 크론 사건을 받고 있었습니다");
    assert.match(String(row.id), /^[0-9a-f-]{36}$/, "대리 키가 채워지지 않았습니다");
  }
});

test("채널마다 사건 수신 보드는 하나뿐이다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO channel_kanban_boards
             (id, channel_id, gateway_id, board_slug, is_event_carrier, created_at, updated_at)
           VALUES ('dup', 'chan-1', 'gw-1', 'deskrpg-second', 1, 'x', 'x')`,
        )
        .run(),
    /UNIQUE/,
    "둘째 carrier 가 들어갔습니다 — 크론 사건이 두 번 소비됩니다",
  );
});

test("같은 채널에 다른 보드는 여러 개 붙는다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  db.prepare(
    `INSERT INTO channel_kanban_boards
       (id, channel_id, gateway_id, board_slug, is_event_carrier, created_at, updated_at)
     VALUES ('second', 'chan-1', 'gw-1', 'deskrpg-aaa-b2c3d4e5', 0, 'x', 'x')`,
  ).run();
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM channel_kanban_boards WHERE channel_id = 'chan-1'")
    .get() as Row;
  assert.equal(count.n, 2);
});

test("같은 채널에 같은 슬러그는 두 번 붙지 않는다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO channel_kanban_boards
             (id, channel_id, gateway_id, board_slug, is_event_carrier, created_at, updated_at)
           VALUES ('dup2', 'chan-1', 'gw-1', 'deskrpg-aaa', 0, 'x', 'x')`,
        )
        .run(),
    /UNIQUE/,
  );
});

test("멱등 — 두 번 돌려도 행이 그대로다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  const first = db.prepare("SELECT id FROM channel_kanban_boards ORDER BY channel_id").all();
  ensureProjectRegistry(db);
  const second = db.prepare("SELECT id FROM channel_kanban_boards ORDER BY channel_id").all();
  assert.deepEqual(second, first, "두 번째 실행이 표를 다시 만들었습니다");
});

test("메타 표가 생기고 서브프로젝트 슬러그는 프로젝트 안에서 유일하다", () => {
  const db = legacyDb();
  ensureProjectRegistry(db);
  assert.ok(columns(db, "channel_projects").includes("origin_meeting_id"));
  assert.ok(columns(db, "channel_projects").includes("hermes_project_id"));
  assert.ok(columns(db, "channel_subprojects").includes("tenant_slug"));

  const boardId = (db.prepare("SELECT id FROM channel_kanban_boards LIMIT 1").get() as Row).id;
  db.prepare(
    `INSERT INTO channel_projects (id, board_link_id, channel_id, status, created_at, updated_at)
     VALUES ('p1', ?, 'chan-1', 'planned', 'x', 'x')`,
  ).run(boardId);
  db.prepare(
    `INSERT INTO channel_subprojects (id, project_id, tenant_slug, name, status, created_at, updated_at)
     VALUES ('s1', 'p1', 'research', '리서치', 'planned', 'x', 'x')`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO channel_subprojects (id, project_id, tenant_slug, name, status, created_at, updated_at)
           VALUES ('s2', 'p1', 'research', '리서치 둘', 'planned', 'x', 'x')`,
        )
        .run(),
    /UNIQUE/,
  );
});

test("빈 DB 는 재구축 없이 새 모양으로 선다", () => {
  const db = new Database(":memory:");
  db.exec(REFERENCED_STUBS);
  db.exec(`
    CREATE TABLE channel_kanban_boards (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      gateway_id TEXT NOT NULL,
      board_slug TEXT NOT NULL,
      is_event_carrier INTEGER NOT NULL DEFAULT 0,
      board_name_synced_at TEXT, event_cursor TEXT, last_polled_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
  ensureProjectRegistry(db);
  assert.ok(columns(db, "channel_kanban_boards").includes("is_event_carrier"));
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='channel_kanban_boards__new'").get(),
    undefined,
    "빈 DB 에 임시 표가 남았습니다",
  );
});
