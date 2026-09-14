-- 2026-04 태스크 시스템 폐기(스펙 R33·R34). 사용자가 데이터 이관 없이 버리기로 했으므로
-- tasks · npc_reports 의 데이터는 복구 없이 삭제된다. Hermes 칸반·cron 이 이 자리를 대신하며
-- (0011 의 channel_kanban_boards / cron_job_origins) 옛 행을 옮기지 않는다.
-- SQLite 쪽 같은 작업은 src/db/sqlite-legacy-tasks-drop.js.
-- npc_reports 가 tasks 를 참조하므로 자식부터 지운다. 이미 없으면 그냥 지나간다.
DROP TABLE IF EXISTS "npc_reports" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tasks" CASCADE;
