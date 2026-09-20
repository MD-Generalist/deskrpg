-- 프로젝트 목록표 (설계 2026-09-21 project-registry).
--
-- ⚠️ 이 파일은 `drizzle-kit generate` 의 출력을 **손으로 고친 것**이다. 생성본을 그대로 쓰면 안 된다:
--   1. 생성본은 기존 PK 를 떼는 줄을 주석으로만 남긴다(제약 이름을 모른다고). 그 상태로
--      `ADD COLUMN "id" ... PRIMARY KEY` 가 돌면 "multiple primary keys" 로 실패한다.
--   2. 생성본에는 기존 행을 사건 수신 보드로 표시하는 UPDATE 가 없다. 그대로 적용하면
--      모든 채널이 carrier 를 잃고 **크론 사건을 아무도 받지 않는다** — 화면은 멀쩡한데
--      카드만 안 움직이는 조용한 실패다.
-- 스키마 스냅샷(meta/0017_snapshot.json)은 생성본 그대로라 다음 generate 의 기준이 된다.
--
-- FK 는 ALTER 로 떼지 않고 CREATE 안에 둔다 — PostgreSQL 은 `ADD CONSTRAINT IF NOT EXISTS`
-- 를 지원하지 않아 재실행이 깨진다.

-- ---------------------------------------------------------------------------
-- 1) channel_kanban_boards — PK 를 channel_id 에서 대리 키 id 로 옮긴다.
--    채널이 보드를 여러 개 가질 수 있어야 "보드 = 프로젝트" 가 성립한다.
--    행과 event_cursor 는 그대로 보존한다 — 커서를 잃으면 사건을 한 구간 통째로 놓친다.
-- ---------------------------------------------------------------------------
ALTER TABLE "channel_kanban_boards" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "channel_kanban_boards" SET "id" = gen_random_uuid() WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "channel_kanban_boards" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "channel_kanban_boards" ADD COLUMN IF NOT EXISTS "is_event_carrier" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 이관 전의 모든 행은 그 채널의 유일한 보드였고 크론·아티팩트 사건을 이미 받고 있었다.
-- 무조건 UPDATE 로 쓰면 안 된다: 채널에 보드가 둘 이상 생긴 뒤 이 파일이 다시 돌면 모든 행이
-- carrier 가 되어 부분 유니크(channel_kanban_boards_carrier_idx)를 깬다(실측 재현).
-- 그래서 "carrier 가 하나도 없는 채널" 에만, "가장 오래된 보드 하나" 에만 표시한다.
UPDATE "channel_kanban_boards" b SET "is_event_carrier" = true
WHERE b."id" = (
  SELECT c."id" FROM "channel_kanban_boards" c
  WHERE c."channel_id" = b."channel_id"
  ORDER BY c."created_at", c."id" LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "channel_kanban_boards" d
  WHERE d."channel_id" = b."channel_id" AND d."is_event_carrier"
);--> statement-breakpoint

-- PK 이동도 "PK 가 아직 channel_id 위에 있는가" 를 직접 묻고서 한다.
-- 예외를 삼키는 모양(DO $$ … EXCEPTION)은 제약 이름이 다르면 DROP 과 ADD 가 **둘 다 조용히**
-- 삼켜지고, 한참 뒤 channel_projects 의 FK 생성에서 "no unique constraint matching" 이라는
-- 엉뚱한 메시지로 터진다. 재적용 때 (id) PK 를 떼려 드는 경로도 이 조건이 막는다 —
-- 그 DROP 은 channel_projects 의 FK 가 매달려 있어 dependent_objects_still_exist 로 죽는다.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.conrelid = 'channel_kanban_boards'::regclass
      AND k.contype = 'p'
      AND a.attname = 'channel_id'
  ) THEN
    ALTER TABLE "channel_kanban_boards" DROP CONSTRAINT "channel_kanban_boards_pkey";
    ALTER TABLE "channel_kanban_boards" ADD PRIMARY KEY ("id");
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2) 프로젝트·서브프로젝트 메타. 이름·설명·진행률은 Hermes 정본이라 여기 없다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "channel_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_link_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"lead_npc_id" uuid,
	"target_date" date,
	"color" varchar(16),
	"icon" varchar(40),
	"pause_reason" text,
	"origin_meeting_id" uuid,
	"hermes_project_id" varchar(64),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_projects_board_link_id_unique" UNIQUE("board_link_id"),
	CONSTRAINT "channel_projects_board_link_id_channel_kanban_boards_id_fk" FOREIGN KEY ("board_link_id") REFERENCES "public"."channel_kanban_boards"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "channel_projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "channel_projects_lead_npc_id_npcs_id_fk" FOREIGN KEY ("lead_npc_id") REFERENCES "public"."npcs"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "channel_projects_origin_meeting_id_meeting_minutes_id_fk" FOREIGN KEY ("origin_meeting_id") REFERENCES "public"."meeting_minutes"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "channel_projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "channel_subprojects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tenant_slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"status" varchar(24) DEFAULT 'planned' NOT NULL,
	"lead_npc_id" uuid,
	"target_date" date,
	"color" varchar(16),
	"icon" varchar(40),
	"pause_reason" text,
	"origin_meeting_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_subprojects_project_id_channel_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."channel_projects"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "channel_subprojects_lead_npc_id_npcs_id_fk" FOREIGN KEY ("lead_npc_id") REFERENCES "public"."npcs"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "channel_subprojects_origin_meeting_id_meeting_minutes_id_fk" FOREIGN KEY ("origin_meeting_id") REFERENCES "public"."meeting_minutes"("id") ON DELETE set null ON UPDATE no action
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_channel_projects_channel" ON "channel_projects" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_subprojects_project_tenant_idx" ON "channel_subprojects" USING btree ("project_id","tenant_slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_kanban_boards_channel_slug_idx" ON "channel_kanban_boards" USING btree ("channel_id","board_slug");--> statement-breakpoint
-- 채널마다 사건 수신 보드는 정확히 하나 — 부분 유니크(사무실 방 불변식과 같은 수법).
CREATE UNIQUE INDEX IF NOT EXISTS "channel_kanban_boards_carrier_idx" ON "channel_kanban_boards" USING btree ("channel_id") WHERE "channel_kanban_boards"."is_event_carrier";
