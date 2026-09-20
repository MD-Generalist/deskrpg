-- 임시 비밀번호 발급 표시(설계 2026-09-20 비밀번호 복구). 추가만 한다.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
