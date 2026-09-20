// 칸반 보드·cron 작업 장부 테이블과 그에 딸린 컬럼 두 개. 두 부트스트랩(src/db/index.ts,
// server-db.js)이 같이 부른다 — 한쪽에만 넣으면 그 경로가 여는 DB 에서만 조용히
// "no such table/column" 이 난다(chat_rooms 와 같은 이유로 공용 모듈에 둔다).
"use strict";

const KANBAN_CRON_TABLES = `
  CREATE TABLE IF NOT EXISTS channel_kanban_boards (
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
  -- (channel_id, board_slug)·carrier 유니크 인덱스는 여기서 만들지 않는다. 기존 DB 는 이 시점에
  -- 아직 옛 모양(carrier 컬럼 없음)이라 터진다 — 재구축을 마친 sqlite-project-registry.js 몫이다.
  CREATE INDEX IF NOT EXISTS idx_channel_kanban_boards_gateway_id ON channel_kanban_boards(gateway_id);
  CREATE TABLE IF NOT EXISTS cron_job_origins (
    id TEXT PRIMARY KEY NOT NULL,
    gateway_id TEXT NOT NULL REFERENCES gateway_resources(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL,
    job_id TEXT NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE(gateway_id, profile_name, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cron_job_origins_channel_id ON cron_job_origins(channel_id);
  CREATE UNIQUE INDEX IF NOT EXISTS cron_job_origins_gateway_profile_job_idx ON cron_job_origins(gateway_id, profile_name, job_id);
`;

/** 기존 DB 에 더할 컬럼. 테이블별로 묶어 두고, 테이블이 없으면 그 묶음은 건너뛴다. */
const KANBAN_CRON_COLUMNS = {
  // `GET /deskrpg/info` 응답 원문 캐시 — 칸반·cron 지원 여부를 여기서 읽는다.
  gateway_resources: ["ALTER TABLE gateway_resources ADD COLUMN plugin_info_json TEXT"],
  // 시스템 메시지의 구조화 페이로드. 일반 메시지는 NULL.
  chat_room_messages: ["ALTER TABLE chat_room_messages ADD COLUMN notice_json TEXT"],
};

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

/**
 * 테이블 두 개를 만들고 컬럼 두 개를 더한다. 멱등 — 매 부팅마다 돌아도 된다.
 * ALTER 는 "duplicate column name" 만 삼키고 나머지 오류는 그대로 올린다.
 */
function ensureKanbanCronBookkeeping(sqlite) {
  sqlite.exec(KANBAN_CRON_TABLES);
  for (const [table, statements] of Object.entries(KANBAN_CRON_COLUMNS)) {
    if (!tableExists(sqlite, table)) continue;
    for (const statement of statements) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        if (!String(error).includes("duplicate column name")) throw error;
      }
    }
  }
}

module.exports = { KANBAN_CRON_TABLES, KANBAN_CRON_COLUMNS, ensureKanbanCronBookkeeping };
