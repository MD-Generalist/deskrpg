// 맵 에디터 폐기 — SQLite 런타임 마이그레이션.
//
// 두 부트스트랩(src/db/index.ts, src/db/server-db.js)이 같이 부른다. 한쪽에만 넣으면 그 경로가
// 여는 DB 에는 죽은 표와 옛 외형이 남아, API 라우트와 소켓 서버가 서로 다른 데이터를 본다.
// PostgreSQL 쪽 같은 작업은 drizzle/0013_drop_map_editor_tables.sql — 두 파일은 같은 두 단계를
// 같은 순서로 밟는다(외형 변환 → 표 삭제).
//
// 사용자가 설치본 데이터 손실까지 알고 승인한 삭제다. 보존 우회를 만들지 않는다.
"use strict";

/** 지울 맵 에디터 표. 자식 → 부모 순서다(FK 가 켜져 있어도 걸리지 않는다). */
const MAP_EDITOR_TABLES = [
  "map_portals",
  "maps",
  "map_templates",
  "project_tilesets",
  "project_stamps",
  "projects",
  "tileset_images",
  "stamps",
];

/**
 * src/game/three/office-looks.ts 의 OFFICE_LOOKS ID 전부(50개).
 * 이 모듈은 TS 빌드 없이 server.js 가 require 하므로 목록을 여기에 박아 둔다.
 * 신선도는 src/db/map-editor-retirement.test.ts 가 OFFICE_LOOKS 와 대조해 지킨다.
 */
const OFFICE_LOOK_IDS = [
  "office-jun",
  "office-tae",
  "office-seo",
  "office-min",
  "office-do",
  "office-yun",
  "office-ha",
  "office-jin",
  "office-eun",
  "office-hyeon",
  "office-nari",
  "office-roan",
  "office-soi",
  "office-yul",
  "office-bomi",
  "office-jiho",
  "office-dami",
  "office-seul",
  "office-kyu",
  "office-ara",
  "office-ian",
  "office-rumi",
  "office-gonu",
  "office-haena",
  "office-woojin",
  "office-jua",
  "office-taemin",
  "office-sera",
  "office-hosu",
  "office-yena",
  "office-sungho",
  "office-hyejin",
  "office-jungwon",
  "office-seok",
  "office-mira",
  "office-kyung",
  "office-yeon",
  "office-dohun",
  "office-suhye",
  "office-jaewon",
  "office-daeun",
  "office-jiseok",
  "office-seona",
  "office-haram",
  "office-chan",
  "office-eunsol",
  "office-sejin",
  "office-hyo",
  "office-yumin",
  "office-garam",
];

/** 옛 외형의 bodyType === "female" 이 접히는 룩. */
const FEMALE_LOOK_ID = "office-nari";
/** 그 밖(male·없음·알 수 없는 값)이 접히는 기본 룩. */
const DEFAULT_LOOK_ID = "office-jun";

/** 외형을 담은 표와 컬럼. npcs 는 값만 고치고 컬럼은 남긴다. */
const APPEARANCE_TABLES = ["characters", "hermes_profiles", "npcs"];

const VALID_LOOK_IDS = new Set(OFFICE_LOOK_IDS);

/** @param {import('better-sqlite3').Database} sqlite */
function tableColumns(sqlite, table) {
  try {
    return sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * 저장된 외형 한 건을 정본 형태로 접는다. 이미 유효한 룩 ID 를 가졌으면 null 을 돌려
 * 호출부가 그 행을 건드리지 않게 한다(멱등).
 *
 * @param {string | null} raw SQLite 는 외형을 JSON 문자열(text)로 저장한다.
 * @returns {string | null} 새로 써야 할 JSON 문자열, 또는 그대로 두어야 하면 null
 */
function normalizeAppearanceJson(raw) {
  if (raw === null || raw === undefined) return null; // NULL 은 그대로 둔다.

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // 깨진 값은 옛 외형과 같이 기본 룩으로 접는다.
  }

  const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  if (isObject && VALID_LOOK_IDS.has(parsed.officeLookId)) return null; // 이미 정본.

  const female = isObject && parsed.bodyType === "female";
  return JSON.stringify({
    officeLookId: female ? FEMALE_LOOK_ID : DEFAULT_LOOK_ID,
    bodyType: female ? "female" : "male",
  });
}

/**
 * 옛 레이어 방식 외형을 오피스 룩으로 바꾼다. 여러 번 불러도 결과가 같다.
 *
 * @param {import('better-sqlite3').Database} sqlite
 * @returns {Record<string, number>} 표별 변환 건수
 */
function normalizeLegacyAppearances(sqlite) {
  /** @type {Record<string, number>} */
  const converted = {};

  for (const table of APPEARANCE_TABLES) {
    const cols = tableColumns(sqlite, table);
    if (!cols.includes("id") || !cols.includes("appearance")) continue;

    const rows = sqlite
      .prepare(`SELECT id, appearance FROM ${table} WHERE appearance IS NOT NULL`)
      .all();
    const update = sqlite.prepare(`UPDATE ${table} SET appearance = ? WHERE id = ?`);

    let count = 0;
    sqlite.transaction(() => {
      for (const row of rows) {
        const next = normalizeAppearanceJson(row.appearance);
        if (next === null) continue;
        update.run(next, row.id);
        count += 1;
      }
    })();

    if (count > 0) converted[table] = count;
  }

  if (Object.keys(converted).length > 0) {
    console.log(
      "[db] 옛 외형을 오피스 룩으로 변환했습니다:",
      Object.entries(converted)
        .map(([t, n]) => `${t} ${n}건`)
        .join(", "),
    );
  }
  return converted;
}

/** 맵 에디터 표를 지운다. 멱등 — 매 부팅마다 돌아도 된다. */
function dropMapEditorTables(sqlite) {
  for (const table of MAP_EDITOR_TABLES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

/**
 * 맵 에디터 폐기 한 묶음. 외형 변환이 먼저다 — 표 삭제가 먼저 돌아도 결과는 같지만,
 * PG 마이그레이션과 순서를 맞춰 두어야 두 방언을 나란히 읽을 수 있다.
 *
 * @param {import('better-sqlite3').Database} sqlite
 */
function retireMapEditor(sqlite) {
  normalizeLegacyAppearances(sqlite);
  dropMapEditorTables(sqlite);
}

module.exports = {
  MAP_EDITOR_TABLES,
  OFFICE_LOOK_IDS,
  FEMALE_LOOK_ID,
  DEFAULT_LOOK_ID,
  APPEARANCE_TABLES,
  normalizeAppearanceJson,
  normalizeLegacyAppearances,
  dropMapEditorTables,
  retireMapEditor,
};
