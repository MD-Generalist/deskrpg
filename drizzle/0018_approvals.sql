-- 실행 전 승인 관문의 레코드(설계 2026-09-21 execution-approval-gate). 추가만 한다.
-- FK 는 ALTER 로 떼지 않고 CREATE 안에 둔다 — PostgreSQL 은
-- `ADD CONSTRAINT IF NOT EXISTS` 를 지원하지 않아 재실행이 깨진다.
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(24) NOT NULL,
	"requested_by" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"source_json" text NOT NULL,
	"payload_json" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
-- `task_id` 는 Hermes 카드를 가리키기만 한다 — FK 가 아니고 사본도 아니다(하드 게이트 1).
CREATE TABLE IF NOT EXISTS "approval_targets" (
	"approval_id" uuid NOT NULL,
	"task_id" varchar(64) NOT NULL,
	"decision" varchar(16),
	CONSTRAINT "approval_targets_approval_id_task_id_pk" PRIMARY KEY("approval_id","task_id"),
	CONSTRAINT "approval_targets_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- 판단 모음은 채널 안에서 "대기 중" 만 훑는다 — 유일한 조회 모양이다.
CREATE INDEX IF NOT EXISTS "approvals_channel_status_idx" ON "approvals" USING btree ("channel_id","status");
--> statement-breakpoint
-- 카드 하나가 어느 승인에 묶였는지 역으로 찾는다 — 보드의 "승인 대기" 배지가 쓴다.
CREATE INDEX IF NOT EXISTS "approval_targets_task_idx" ON "approval_targets" USING btree ("task_id");
