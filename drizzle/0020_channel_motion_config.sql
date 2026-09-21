-- 채널의 NPC 걸음 속도(호출·회의 호출·일반 이동·산책). 비어 있으면 기본값이다. 추가만 한다.
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "motion_config" jsonb;
