// 직원 패널의 탭별 열람 상태 테이블. 두 부트스트랩(src/db/index.ts, server-db.js)이 같이
// 부른다 — 한쪽에만 넣으면 그 경로가 여는 DB 에서만 조용히 "no such table" 이 난다
// (sqlite-kanban-cron-bookkeeping.js 와 같은 이유로 공용 모듈에 둔다).
"use strict";

const NPC_PANEL_READS_TABLE = `
  CREATE TABLE IF NOT EXISTS npc_panel_reads (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    npc_id TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
    tab TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    seen_ids TEXT,
    PRIMARY KEY (user_id, npc_id, tab)
  );
`;

/** 테이블을 만든다. 멱등 — 매 부팅마다 돌아도 된다. */
function ensureNpcPanelReads(sqlite) {
  sqlite.exec(NPC_PANEL_READS_TABLE);
}

module.exports = { ensureNpcPanelReads };
