-- 직원 패널의 탭별 열람 상태(설계 2026-09-21 담당 카드 탭·배지). 추가만 한다.
-- FK 는 ALTER 로 떼지 않고 CREATE 안에 둔다 — PostgreSQL 은
-- `ADD CONSTRAINT IF NOT EXISTS` 를 지원하지 않아 재실행이 깨진다.
CREATE TABLE IF NOT EXISTS "npc_panel_reads" (
	"user_id" uuid NOT NULL,
	"npc_id" uuid NOT NULL,
	"tab" varchar(8) NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_ids" text,
	CONSTRAINT "npc_panel_reads_user_id_npc_id_tab_pk" PRIMARY KEY("user_id","npc_id","tab"),
	CONSTRAINT "npc_panel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "npc_panel_reads_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action
);
