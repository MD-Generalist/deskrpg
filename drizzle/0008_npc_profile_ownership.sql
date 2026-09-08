-- NPC 프로필 단일소유 — 이름·외형의 정본을 hermes_profiles 로 옮긴다.
-- 순서가 중요하다: 옮기고 → 백업하고 → 지우고 → 제약을 건다.

-- 1) 프로필이 외형을 갖는다
ALTER TABLE "hermes_profiles" ADD COLUMN IF NOT EXISTS "appearance" jsonb;

-- 2) 각 프로필에 연결된 NPC 중 가장 최근 것의 외형을 복사한다.
--    같은 프로필에 NPC 가 여럿이고 외형이 다르면 나머지는 conflicts 에 남긴다.
CREATE TABLE IF NOT EXISTS "npcs_appearance_conflicts" AS
SELECT n.id AS npc_id, n.hermes_profile_id, n.channel_id, n.appearance, n.updated_at
FROM "npcs" n
WHERE n.hermes_profile_id IS NOT NULL
  AND n.id <> (
    SELECT m.id FROM "npcs" m
    WHERE m.hermes_profile_id = n.hermes_profile_id
    ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST
    LIMIT 1
  );

UPDATE "hermes_profiles" hp
SET "appearance" = latest.appearance
FROM (
  SELECT DISTINCT ON (hermes_profile_id) hermes_profile_id, appearance
  FROM "npcs"
  WHERE hermes_profile_id IS NOT NULL
  ORDER BY hermes_profile_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
) latest
WHERE hp.id = latest.hermes_profile_id AND hp."appearance" IS NULL;

-- 3) 출근 여부
ALTER TABLE "npcs" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;

-- 4) 프로필 없는 NPC 는 백업하고 지운다 (되돌릴 수 없는 삭제 전에 남긴다)
CREATE TABLE IF NOT EXISTS "npcs_unprofiled_backup" AS
SELECT * FROM "npcs" WHERE hermes_profile_id IS NULL;
DELETE FROM "npcs" WHERE hermes_profile_id IS NULL;

-- 5) 같은 (channel, profile) 중복은 가장 최근 하나만 남긴다 — 7) 의 유니크 제약 전제
CREATE TABLE IF NOT EXISTS "npcs_duplicate_backup" AS
SELECT * FROM "npcs" n
WHERE n.id <> (
  SELECT m.id FROM "npcs" m
  WHERE m.channel_id = n.channel_id AND m.hermes_profile_id = n.hermes_profile_id
  ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST
  LIMIT 1
);
DELETE FROM "npcs" WHERE id IN (SELECT id FROM "npcs_duplicate_backup");

-- 6) 프로필은 필수, 프로필이 지워지면 배치도 지워진다
ALTER TABLE "npcs" ALTER COLUMN "hermes_profile_id" SET NOT NULL;
ALTER TABLE "npcs" DROP CONSTRAINT IF EXISTS "npcs_hermes_profile_id_hermes_profiles_id_fk";
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_hermes_profile_id_hermes_profiles_id_fk"
  FOREIGN KEY ("hermes_profile_id") REFERENCES "hermes_profiles"("id") ON DELETE CASCADE;

-- 7) 한 채널에 한 프로필은 한 번
CREATE UNIQUE INDEX IF NOT EXISTS "npcs_channel_profile_idx" ON "npcs" ("channel_id", "hermes_profile_id");

-- 8) 자리 미정을 허용한다. 이름·외형은 프로필이 정본이므로 필수가 아니다(컬럼은 남긴다).
ALTER TABLE "npcs" ALTER COLUMN "position_x" DROP NOT NULL;
ALTER TABLE "npcs" ALTER COLUMN "position_y" DROP NOT NULL;
ALTER TABLE "npcs" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "npcs" ALTER COLUMN "appearance" DROP NOT NULL;
