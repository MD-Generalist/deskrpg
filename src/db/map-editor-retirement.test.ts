// 맵 에디터 폐기(0013)의 SQLite 쪽 검증.
//
// 빈 DB 에는 맵 에디터 표가 애초에 만들어지지 않고, 표와 옛 외형이 남은 기존 DB 를 열면
// 두 부트스트랩 모두 표를 지우고 외형을 오피스 룩으로 접는다. 사용자가 데이터 손실까지
// 알고 승인한 삭제이므로 맵 에디터 데이터는 복구되지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRequire } from "node:module";

import { OFFICE_LOOKS } from "@/game/three/office-looks";

const require = createRequire(import.meta.url);
const { SQLITE_BASE_SCHEMA } = require("./sqlite-base-schema.js");
const { ensureSqliteCompatibility } = require("./server-db.js");
const { MAP_EDITOR_TABLES, OFFICE_LOOK_IDS, normalizeAppearanceJson, retireMapEditor } =
  require("./sqlite-map-editor-drop.js") as {
    MAP_EDITOR_TABLES: string[];
    OFFICE_LOOK_IDS: string[];
    normalizeAppearanceJson: (raw: string | null) => string | null;
    retireMapEditor: (sqlite: Database.Database) => void;
  };

// 0012 까지의 기본 스키마에 들어 있던 정의 그대로(FK 관계 포함).
const MAP_EDITOR_DDL = `
  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    tilemap_path TEXT NOT NULL,
    config TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS map_portals (
    id TEXT PRIMARY KEY NOT NULL,
    from_map_id TEXT REFERENCES maps(id),
    to_map_id TEXT REFERENCES maps(id),
    from_x INTEGER NOT NULL,
    from_y INTEGER NOT NULL,
    to_x INTEGER NOT NULL,
    to_y INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS map_templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    spawn_col INTEGER NOT NULL,
    spawn_row INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS stamps (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    layers TEXT NOT NULL,
    tilesets TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tileset_images (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    columns INTEGER NOT NULL,
    tilecount INTEGER NOT NULL,
    image TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tileset_images_name ON tileset_images(name);
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_tilesets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tileset_id TEXT NOT NULL REFERENCES tileset_images(id) ON DELETE CASCADE,
    firstgid INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE(project_id, tileset_id)
  );
  CREATE TABLE IF NOT EXISTS project_stamps (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stamp_id TEXT NOT NULL REFERENCES stamps(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    UNIQUE(project_id, stamp_id)
  );
`;

/** 옛 레이어 방식 외형 한 벌 — 룩 ID 가 없고 레이어 키만 있다. */
function legacyLayers(bodyType?: string): string {
  const value: Record<string, unknown> = {
    layers: {
      body: { itemKey: "body", variant: "light" },
      hair: { itemKey: "hair", variant: "bob" },
    },
    torso: { type: "torso", variant: "shirt" },
  };
  if (bodyType !== undefined) value.bodyType = bodyType;
  return JSON.stringify(value);
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function appearanceOf(db: Database.Database, table: string, id: string): string | null {
  const row = db.prepare(`SELECT appearance FROM ${table} WHERE id = ?`).get(id) as
    { appearance: string | null } | undefined;
  return row ? row.appearance : null;
}

/**
 * 외형이 든 세 표에 변환 시나리오를 한 벌씩 심는다. id 는 표 이름과 시나리오를 합쳐
 * 만들므로 어느 표에서 어긋났는지 실패 메시지로 바로 보인다.
 */
const APPEARANCE_CASES: Array<{ key: string; value: string | null; expected: string | null }> = [
  {
    key: "female",
    value: legacyLayers("female"),
    expected: JSON.stringify({ officeLookId: "office-nari", bodyType: "female" }),
  },
  {
    key: "male",
    value: legacyLayers("male"),
    expected: JSON.stringify({ officeLookId: "office-jun", bodyType: "male" }),
  },
  {
    key: "nobody",
    value: legacyLayers(),
    expected: JSON.stringify({ officeLookId: "office-jun", bodyType: "male" }),
  },
  {
    key: "unknown-look",
    value: JSON.stringify({ officeLookId: "office-does-not-exist", bodyType: "female" }),
    expected: JSON.stringify({ officeLookId: "office-nari", bodyType: "female" }),
  },
  {
    // 이미 정본인 행은 손대지 않는다.
    key: "valid-look",
    value: JSON.stringify({ officeLookId: "office-seo", bodyType: "female" }),
    expected: JSON.stringify({ officeLookId: "office-seo", bodyType: "female" }),
  },
  { key: "null", value: null, expected: null },
  {
    // JSON 이긴 한데 객체가 아닌 값(문자열 JSON). 옛 외형과 같이 기본 룩으로 접는다.
    key: "string-json",
    value: JSON.stringify("office-seo"),
    expected: JSON.stringify({ officeLookId: "office-jun", bodyType: "male" }),
  },
];

function seedAppearances(db: Database.Database): void {
  db.prepare(
    "INSERT INTO users (id, login_id, nickname, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run("u1", "u1", "테스터", "x", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?,?,?)").run("c1", "채널", "u1");
  db.prepare(
    "INSERT INTO gateway_resources (id, owner_user_id, display_name, base_url, token_encrypted, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run("g1", "u1", "gw", "http://localhost:1", "enc", "2026-01-01", "2026-01-01");

  for (const c of APPEARANCE_CASES) {
    // characters.appearance 는 NOT NULL 이라 NULL 시나리오가 없다 — 그 행만 건너뛴다.
    if (c.value !== null) {
      db.prepare("INSERT INTO characters (id, user_id, name, appearance) VALUES (?,?,?,?)").run(
        `char-${c.key}`,
        "u1",
        c.key,
        c.value,
      );
    }

    db.prepare(
      "INSERT INTO hermes_profiles (id, gateway_id, profile_name, token_encrypted, appearance, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(`prof-${c.key}`, "g1", c.key, "enc", c.value, "2026-01-01", "2026-01-01");

    db.prepare(
      "INSERT INTO npcs (id, channel_id, hermes_profile_id, appearance) VALUES (?,?,?,?)",
    ).run(`npc-${c.key}`, "c1", `prof-${c.key}`, c.value);
  }
}

function assertAppearances(db: Database.Database, label: string): void {
  for (const c of APPEARANCE_CASES) {
    if (c.value !== null) {
      assert.equal(
        appearanceOf(db, "characters", `char-${c.key}`),
        c.expected,
        `${label}: characters/${c.key}`,
      );
    }
    assert.equal(
      appearanceOf(db, "hermes_profiles", `prof-${c.key}`),
      c.expected,
      `${label}: hermes_profiles/${c.key}`,
    );
    assert.equal(appearanceOf(db, "npcs", `npc-${c.key}`), c.expected, `${label}: npcs/${c.key}`);
  }
}

test("빈 DB 의 기본 스키마에는 맵 에디터 표가 없다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  ensureSqliteCompatibility(db);

  for (const t of MAP_EDITOR_TABLES) assert.equal(tableExists(db, t), false, t);
  // 다른 표는 정상이다.
  for (const t of [
    "users",
    "channels",
    "characters",
    "npcs",
    "hermes_profiles",
    "chat_rooms",
    "channel_kanban_boards",
    "cron_job_origins",
    "meeting_minutes",
  ]) {
    assert.ok(tableExists(db, t), t);
  }
  db.close();
});

test("맵 에디터 표와 옛 외형이 남은 기존 DB 를 열면 표는 사라지고 외형이 변환된다 — 두 번 열어도 같다", () => {
  const db = new Database(":memory:");
  db.exec(SQLITE_BASE_SCHEMA);
  db.exec(MAP_EDITOR_DDL);
  for (const t of MAP_EDITOR_TABLES) assert.ok(tableExists(db, t), `${t} 가 미리 있어야 한다`);
  seedAppearances(db);

  ensureSqliteCompatibility(db);
  for (const t of MAP_EDITOR_TABLES) assert.equal(tableExists(db, t), false, `${t} 는 지워진다`);
  assertAppearances(db, "1회차");

  // 멱등 — 다시 열어도 결과가 같다.
  ensureSqliteCompatibility(db);
  for (const t of MAP_EDITOR_TABLES) assert.equal(tableExists(db, t), false, `${t} 는 지워진다`);
  assertAppearances(db, "2회차");

  // 채널·NPC 는 그대로다.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM npcs").get() as { n: number }).n,
    APPEARANCE_CASES.length,
  );
  db.close();
});

test("공용 모듈 단독으로도 멱등이고, 표가 없어도 오류가 없다", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);`);
  retireMapEditor(db);
  retireMapEditor(db);
  for (const t of MAP_EDITOR_TABLES) assert.equal(tableExists(db, t), false, t);
  assert.ok(tableExists(db, "users"));
  db.close();
});

test("NULL 외형과 유효한 룩은 변환 대상이 아니다", () => {
  assert.equal(normalizeAppearanceJson(null), null);
  assert.equal(
    normalizeAppearanceJson(JSON.stringify({ officeLookId: "office-yun", bodyType: "female" })),
    null,
  );
  // 깨진 JSON 은 옛 외형과 같이 기본 룩으로 접는다.
  assert.equal(
    normalizeAppearanceJson("{not json"),
    JSON.stringify({ officeLookId: "office-jun", bodyType: "male" }),
  );
});

/**
 * SQLite 모듈과 `drizzle/0013_drop_map_editor_tables.sql` 은 OFFICE_LOOKS 목록을 리터럴로
 * 박아 둔다(CJS 모듈은 TS 를 require 할 수 없고, SQL 은 아무것도 import 하지 않는다).
 * 룩이 늘거나 줄면 이 테스트가 먼저 빨개진다 — 목록이 낡으면 이미 정본인 행을 다시
 * 기본 룩으로 접어 버린다.
 */
test("박아 둔 룩 ID 목록이 OFFICE_LOOKS 와 같다 (JS 모듈·SQL 양쪽)", async () => {
  const expected = OFFICE_LOOKS.map((look) => look.id);
  assert.deepEqual(OFFICE_LOOK_IDS, expected, "sqlite-map-editor-drop.js 의 목록이 낡았습니다");

  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const sqlPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../drizzle/0013_drop_map_editor_tables.sql",
  );
  const sql = readFileSync(sqlPath, "utf8");
  const declared = [...sql.matchAll(/'(office-[a-z]+)'/g)].map((m) => m[1]);
  // office-nari / office-jun 은 변환 규칙에도 나오므로 중복을 접고 집합으로 비교한다.
  assert.deepEqual(
    [...new Set(declared)].sort(),
    [...expected].sort(),
    "0013 마이그레이션의 룩 ID 목록이 낡았습니다",
  );
});
