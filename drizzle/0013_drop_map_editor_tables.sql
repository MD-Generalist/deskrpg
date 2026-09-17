-- 맵 에디터 표 8개 폐기 + 옛 외형을 오피스 룩으로 변환.
--
-- 사용자가 설치본 데이터 손실까지 알고 승인한 삭제다. 맵 에디터 UI·API·라이브러리는 이미
-- 제거됐고 여기서 남은 표 정의를 걷어낸다. 채널 생성은 `map_templates` 대신 환경 ID 를 받아
-- 생성된 배치를 `channels.map_data` 에 바로 넣는다. SQLite 쪽 같은 작업은
-- src/db/sqlite-map-editor-drop.js 에 있다 — 두 파일은 같은 두 단계를 같은 순서로 밟는다.

-- 1) 외형 변환이 먼저다. 표 삭제는 되돌릴 수 없으므로, 데이터 손질이 실패하면
--    같은 트랜잭션 안에서 함께 되돌아가야 한다.
--    규칙: officeLookId 가 없거나 OFFICE_LOOKS 에 없는 값이면 옛 bodyType 이 'female' 일 때
--    office-nari, 그 밖(male·없음·알 수 없는 값)이면 office-jun 으로 접는다. 결과는
--    { officeLookId, bodyType } 정본 형태이고 옛 레이어 키는 버린다. 유효한 룩 ID 를 가진
--    행은 건드리지 않으므로 몇 번 돌려도 같다.
--    아래 목록은 src/game/three/office-looks.ts 의 OFFICE_LOOKS ID 전부다(50개).
--    src/db/map-editor-retirement.test.ts 가 이 목록의 신선도를 지킨다.
DO $$
DECLARE
  valid_looks text[] := ARRAY[
    'office-jun', 'office-tae', 'office-seo', 'office-min',
    'office-do', 'office-yun', 'office-ha', 'office-jin',
    'office-eun', 'office-hyeon', 'office-nari', 'office-roan',
    'office-soi', 'office-yul', 'office-bomi', 'office-jiho',
    'office-dami', 'office-seul', 'office-kyu', 'office-ara',
    'office-ian', 'office-rumi', 'office-gonu', 'office-haena',
    'office-woojin', 'office-jua', 'office-taemin', 'office-sera',
    'office-hosu', 'office-yena', 'office-sungho', 'office-hyejin',
    'office-jungwon', 'office-seok', 'office-mira', 'office-kyung',
    'office-yeon', 'office-dohun', 'office-suhye', 'office-jaewon',
    'office-daeun', 'office-jiseok', 'office-seona', 'office-haram',
    'office-chan', 'office-eunsol', 'office-sejin', 'office-hyo',
    'office-yumin', 'office-garam'
  ];
  converted integer;
BEGIN
  UPDATE "characters"
  SET "appearance" = jsonb_build_object(
    'officeLookId',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'office-nari' ELSE 'office-jun' END,
    'bodyType',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'female' ELSE 'male' END
  )
  WHERE "appearance" IS NOT NULL
    AND COALESCE(
          CASE WHEN jsonb_typeof("appearance") = 'object' THEN "appearance"->>'officeLookId' END,
          ''
        ) <> ALL (valid_looks);
  GET DIAGNOSTICS converted = ROW_COUNT;
  RAISE NOTICE 'characters.appearance 변환: %건', converted;

  UPDATE "hermes_profiles"
  SET "appearance" = jsonb_build_object(
    'officeLookId',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'office-nari' ELSE 'office-jun' END,
    'bodyType',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'female' ELSE 'male' END
  )
  WHERE "appearance" IS NOT NULL
    AND COALESCE(
          CASE WHEN jsonb_typeof("appearance") = 'object' THEN "appearance"->>'officeLookId' END,
          ''
        ) <> ALL (valid_looks);
  GET DIAGNOSTICS converted = ROW_COUNT;
  RAISE NOTICE 'hermes_profiles.appearance 변환: %건', converted;

  -- npcs.appearance 는 값만 고치고 컬럼은 남긴다. 정본은 hermes_profiles 지만 옛 행이
  -- 남아 있으므로 같은 규칙으로 접어 둔다.
  UPDATE "npcs"
  SET "appearance" = jsonb_build_object(
    'officeLookId',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'office-nari' ELSE 'office-jun' END,
    'bodyType',
    CASE WHEN jsonb_typeof("appearance") = 'object' AND "appearance"->>'bodyType' = 'female'
         THEN 'female' ELSE 'male' END
  )
  WHERE "appearance" IS NOT NULL
    AND COALESCE(
          CASE WHEN jsonb_typeof("appearance") = 'object' THEN "appearance"->>'officeLookId' END,
          ''
        ) <> ALL (valid_looks);
  GET DIAGNOSTICS converted = ROW_COUNT;
  RAISE NOTICE 'npcs.appearance 변환: %건', converted;
END $$;--> statement-breakpoint

-- 2) 맵 에디터 표를 자식 → 부모 순서로 지운다. 이미 없으면 그냥 지나간다.
DROP TABLE IF EXISTS "map_portals" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maps" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "map_templates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project_tilesets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "project_stamps" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "projects" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tileset_images" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "stamps" CASCADE;
