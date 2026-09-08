-- 데이터 전용 마이그레이션 — 스키마는 0008 그대로다.
--
-- 0008 이후 NPC 는 "게이트웨이가 채널에 묶일 때" 만들어진다. 그래서 업그레이드 직후
-- 기존 채널에는 이미 `npcs` 행이 있던 프로필만 출근부에 보이고, 나머지 프로필은
-- 사용자가 연결을 풀었다 다시 걸기 전까지 영원히 나타나지 않는다. 한 번만 도는
-- 마이그레이션에서 그 공백을 메운다.
--
-- 시작 시 백필로 하면 안 된다: 매 부팅마다 돌면서 사용자가 재운(`active=false`) NPC 를
-- 되살린다. 여기서는 `ON CONFLICT DO NOTHING` 이 기존 행을 그대로 둔다 — 재운 NPC 는
-- 재운 채 남는다.
INSERT INTO "npcs" ("channel_id", "hermes_profile_id", "active")
SELECT b."channel_id", hp."id", true
FROM "channel_gateway_bindings" b
JOIN "hermes_profiles" hp ON hp."gateway_id" = b."gateway_id"
ON CONFLICT ("channel_id", "hermes_profile_id") DO NOTHING;
