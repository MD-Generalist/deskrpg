-- 내 캐릭터 소개(스펙 2026-09-18 single-character-user-context). 추가만 한다.
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "bio" text;
