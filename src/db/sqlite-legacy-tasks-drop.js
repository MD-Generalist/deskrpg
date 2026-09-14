// 2026-04 태스크 시스템(tasks / npc_reports)을 걷어낸다. 사용자가 데이터 이관 없이 폐기하기로
// 했으므로 두 테이블은 복구 없이 지운다. PostgreSQL 쪽 같은 작업은 drizzle/0012_drop_legacy_tasks.sql.
// 두 부트스트랩(src/db/index.ts, server-db.js)이 같이 부른다 — 한쪽에만 넣으면 그 경로가
// 여는 DB 에는 죽은 테이블이 남아 스키마 대조 테스트가 갈린다.
"use strict";

// npc_reports 가 tasks 를 참조하므로 자식부터 지운다.
const LEGACY_TASK_TABLES = ["npc_reports", "tasks"];

/** 레거시 태스크 테이블을 지운다. 멱등 — 매 부팅마다 돌아도 된다. */
function dropLegacyTaskTables(sqlite) {
  for (const table of LEGACY_TASK_TABLES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

module.exports = { LEGACY_TASK_TABLES, dropLegacyTaskTables };
