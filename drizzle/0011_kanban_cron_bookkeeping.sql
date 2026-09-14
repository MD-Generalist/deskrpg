-- 칸반·cron 장부(스펙 2026-09 hermes-kanban-cron). 추가만 한다 — 레거시 tasks / npc_reports 는
-- 다음 마이그레이션이 코드와 함께 걷어낸다.
-- channel_kanban_boards: 채널 ↔ Hermes 칸반 보드 연결. 채널마다 보드 하나라 channel_id 가 PK.
-- cron_job_origins: DeskRPG 가 만든 Hermes cron 작업의 출처. (gateway, profile, job) 조합이 유일.
-- chat_room_messages.notice_json: 시스템 메시지의 구조화 페이로드(칸반 카드 이동·cron 결과 알림).
-- gateway_resources.plugin_info_json: `GET /deskrpg/info` 응답 원문 캐시.
CREATE TABLE IF NOT EXISTS "channel_kanban_boards" (
  "channel_id" uuid PRIMARY KEY NOT NULL REFERENCES "channels"("id") ON DELETE cascade,
  "gateway_id" uuid NOT NULL REFERENCES "gateway_resources"("id") ON DELETE cascade,
  "board_slug" varchar(64) NOT NULL,
  "board_name_synced_at" timestamp with time zone,
  "event_cursor" text,
  "last_polled_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_channel_kanban_boards_gateway_id" ON "channel_kanban_boards" ("gateway_id");

CREATE TABLE IF NOT EXISTS "cron_job_origins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL REFERENCES "gateway_resources"("id") ON DELETE cascade,
  "profile_name" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "channels"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_cron_job_origins_channel_id" ON "cron_job_origins" ("channel_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cron_job_origins_gateway_profile_job_idx" ON "cron_job_origins" ("gateway_id", "profile_name", "job_id");

ALTER TABLE "chat_room_messages" ADD COLUMN IF NOT EXISTS "notice_json" text;
ALTER TABLE "gateway_resources" ADD COLUMN IF NOT EXISTS "plugin_info_json" text;
