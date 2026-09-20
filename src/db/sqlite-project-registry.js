// 프로젝트 목록표의 SQLite 짝 (설계 2026-09-21 project-registry).
//
// 두 일을 한다.
//   1. 기존 DB 의 `channel_kanban_boards` 를 **재구축**한다 — PK 를 channel_id 에서 대리 키
//      id 로 옮기기 위해서다. SQLite 는 PK 를 ALTER 로 바꿀 수 없어 새 표로 복사하고 rename
//      하는 길뿐이다. 빈 DB 는 `sqlite-kanban-cron-bookkeeping.js` 가 이미 새 모양으로
//      만들므로 여기서 할 일이 없다(판정은 `id` 컬럼의 유무).
//   2. 프로젝트·서브프로젝트 메타 표를 만든다.
//
// 두 부트스트랩(src/db/index.ts, server-db.js)이 같이 부른다 — 한쪽에만 넣으면 그 경로가
// 여는 DB 에서만 조용히 "no such table/column" 이 난다.
//
// **순서가 중요하다.** 재구축은 `channel_projects` 가 생기기 전에 끝나야 한다. 메타 표가
// 먼저 생기면 그 FK 가 `channel_kanban_boards` 를 가리키는 채로 DROP 이 돌아, 외래 키가
// 켜진 DB 에서 실패하거나 꺼진 DB 에서 조용히 끊어진 참조를 남긴다.
"use strict";

const { randomUUID } = require("node:crypto");

const PROJECT_TABLES = `
  CREATE TABLE IF NOT EXISTS channel_projects (
    id TEXT PRIMARY KEY NOT NULL,
    board_link_id TEXT NOT NULL UNIQUE REFERENCES channel_kanban_boards(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'planned',
    lead_npc_id TEXT REFERENCES npcs(id) ON DELETE SET NULL,
    target_date TEXT,
    color TEXT,
    icon TEXT,
    pause_reason TEXT,
    origin_meeting_id TEXT REFERENCES meeting_minutes(id) ON DELETE SET NULL,
    hermes_project_id TEXT,
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_channel_projects_channel ON channel_projects(channel_id);
  CREATE TABLE IF NOT EXISTS channel_subprojects (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES channel_projects(id) ON DELETE CASCADE,
    tenant_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    lead_npc_id TEXT REFERENCES npcs(id) ON DELETE SET NULL,
    target_date TEXT,
    color TEXT,
    icon TEXT,
    pause_reason TEXT,
    origin_meeting_id TEXT REFERENCES meeting_minutes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS channel_subprojects_project_tenant_idx
    ON channel_subprojects(project_id, tenant_slug);
`;

const REBUILT_BOARDS_TABLE = `
  CREATE TABLE channel_kanban_boards__new (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    board_slug TEXT NOT NULL,
    is_event_carrier INTEGER NOT NULL DEFAULT 0,
    board_name_synced_at TEXT,
    event_cursor TEXT,
    last_polled_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const BOARD_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_channel_kanban_boards_gateway_id ON channel_kanban_boards(gateway_id);
  CREATE UNIQUE INDEX IF NOT EXISTS channel_kanban_boards_channel_slug_idx
    ON channel_kanban_boards(channel_id, board_slug);
  CREATE UNIQUE INDEX IF NOT EXISTS channel_kanban_boards_carrier_idx
    ON channel_kanban_boards(channel_id) WHERE is_event_carrier;
`;

const CARRIED_COLUMNS = [
  "channel_id",
  "gateway_id",
  "board_slug",
  "board_name_synced_at",
  "event_cursor",
  "last_polled_at",
  "last_error",
  "created_at",
  "updated_at",
];

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function hasColumn(sqlite, table, column) {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

/**
 * 옛 모양(channel_id 가 PK)을 새 모양(id 가 PK, is_event_carrier 있음)으로 옮긴다.
 *
 * 행과 `event_cursor` 는 그대로 옮긴다 — 커서를 버리면 그 채널이 사건을 한 구간 통째로
 * 놓친다. 이관 전의 모든 행은 그 채널의 유일한 보드였고 크론·아티팩트 사건을 이미 받고
 * 있었으므로 전부 `is_event_carrier = 1` 이다.
 */
function rebuildBoardsTable(sqlite) {
  const rows = sqlite
    .prepare(`SELECT ${CARRIED_COLUMNS.join(", ")} FROM channel_kanban_boards`)
    .all();

  sqlite.exec("DROP TABLE IF EXISTS channel_kanban_boards__new");
  sqlite.exec(REBUILT_BOARDS_TABLE);

  const insert = sqlite.prepare(
    `INSERT INTO channel_kanban_boards__new (id, is_event_carrier, ${CARRIED_COLUMNS.join(", ")})
     VALUES (@id, 1, ${CARRIED_COLUMNS.map((c) => `@${c}`).join(", ")})`,
  );
  for (const row of rows) insert.run({ ...row, id: randomUUID() });

  sqlite.exec("DROP TABLE channel_kanban_boards");
  sqlite.exec("ALTER TABLE channel_kanban_boards__new RENAME TO channel_kanban_boards");
  sqlite.exec(BOARD_INDEXES);
  return rows.length;
}

/**
 * 재구축과 메타 표 생성. 멱등 — 매 부팅마다 돌아도 된다.
 *
 * 외래 키는 재구축 동안만 끈다. `DROP TABLE` 이 참조를 끊는 것을 막기 위해서이고,
 * 원래 값은 끝나고 되돌린다. PRAGMA 는 트랜잭션 안에서 바꿀 수 없어 밖에서 다룬다.
 */
function ensureProjectRegistry(sqlite) {
  if (
    tableExists(sqlite, "channel_kanban_boards") &&
    !hasColumn(sqlite, "channel_kanban_boards", "id")
  ) {
    const fkWasOn = sqlite.pragma("foreign_keys", { simple: true });
    if (fkWasOn) sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.transaction(() => rebuildBoardsTable(sqlite))();
    } finally {
      if (fkWasOn) sqlite.pragma("foreign_keys = ON");
    }
  }
  // 재구축을 했든 안 했든(빈 DB 포함) 인덱스는 늘 보장한다.
  if (tableExists(sqlite, "channel_kanban_boards")) sqlite.exec(BOARD_INDEXES);
  sqlite.exec(PROJECT_TABLES);
}

module.exports = { ensureProjectRegistry };
