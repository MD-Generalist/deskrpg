-- 회의 결과 구조화(설계 2026-09-21 회의 결론에서 프로젝트 등록 제안까지). 추가만 한다.
ALTER TABLE "meeting_minutes" ADD COLUMN IF NOT EXISTS "outcome_json" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN IF NOT EXISTS "summary_status" text DEFAULT 'ok' NOT NULL;
