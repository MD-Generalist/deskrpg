// SQLite 는 ALTER 로 NOT NULL·FK 를 못 바꾼다. npcs 를 새 정의로 다시 만든다.
// PostgreSQL 쪽 같은 작업은 drizzle/0008_npc_profile_ownership.sql 에 있다. 두 파일은
// 같은 순서를 지킨다: 옮기고 → 백업하고 → 지우고 → 제약.
"use strict";

function columns(sqlite, table) {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

// 이관 쿼리가 실제로 읽고 쓰는 열들. 이 중 하나라도 없으면 npcs 는 아직 "진짜 레거시"
// 모양이 아니다 — RBAC 테스트 등이 쓰는 최소 픽스처(id, channel_id 뿐인 npcs)가 그렇다.
// 그런 DB 는 sqlite-base-schema.js 가 새 정의로 만들 몫이라 여기서는 손대지 않는다.
const LEGACY_NPC_COLUMNS = [
  "appearance",
  "hermes_profile_id",
  "channel_id",
  "created_at",
  "updated_at",
];

// `npcs.id` 를 ON DELETE CASCADE 로 참조하는 테이블들. PostgreSQL 0008 의 4a·5a 단계와
// 같은 이름의 백업 테이블에 담는다. 최소 픽스처에는 없을 수 있으니 존재하는 것만 훑는다.
// (0008 이 백업하던 옛 태스크·보고 테이블은 2026-04 태스크 시스템 폐기와 함께 지워졌다 —
// 0012 / sqlite-legacy-tasks-drop.js.)
const CASCADING_CHILD_TABLES = [
  ["chat_messages", "npcs_removed_chat_messages_backup"],
  ["npc_sessions", "npcs_removed_npc_sessions_backup"],
];

/** 곧 지워질 NPC 집합(`sourceBackup` 의 id)에 매달린 자식 행을 백업 테이블로 옮긴다. */
function backupCascadingChildren(sqlite, sourceBackup) {
  for (const [child, backup] of CASCADING_CHILD_TABLES) {
    if (!tableExists(sqlite, child)) continue;
    const select = `SELECT * FROM ${child} WHERE npc_id IN (SELECT id FROM ${sourceBackup})`;
    if (tableExists(sqlite, backup)) {
      sqlite.exec(`INSERT INTO ${backup} ${select}`);
    } else {
      sqlite.exec(`CREATE TABLE ${backup} AS ${select}`);
    }
  }
}

function migrateNpcsToProfileOwnership(sqlite) {
  // npcs 나 hermes_profiles 가 아직 없는 DB(최소 픽스처, 신규 부트스트랩 이전 단계)에는
  // 옮길 것도 재생성할 것도 없다 — sqlite-base-schema.js 가 새 정의로 만든다.
  if (!tableExists(sqlite, "npcs") || !tableExists(sqlite, "hermes_profiles")) return null;
  const npcCols = columns(sqlite, "npcs");
  if (npcCols.includes("active")) return null; // 이미 적용됨
  if (!LEGACY_NPC_COLUMNS.every((c) => npcCols.includes(c))) return null; // 진짜 레거시 모양이 아니다

  // 1) 외형 이관 + 백업 + 삭제는 한 트랜잭션. SQLite 는 트랜잭션 안에서
  // `PRAGMA foreign_keys` 변경을 무시하므로, 테이블 재생성은 별도 트랜잭션으로 뺀다.
  const prepare = sqlite.transaction(() => {
    if (!columns(sqlite, "hermes_profiles").includes("appearance")) {
      sqlite.exec(`ALTER TABLE hermes_profiles ADD COLUMN appearance TEXT`);
    }

    // 2) 외형 이관 — 프로필별 최신 NPC
    const moved = sqlite
      .prepare(
        `
      UPDATE hermes_profiles SET appearance = (
        SELECT n.appearance FROM npcs n
        WHERE n.hermes_profile_id = hermes_profiles.id
        ORDER BY n.updated_at DESC, n.created_at DESC LIMIT 1)
      WHERE appearance IS NULL
        AND EXISTS (SELECT 1 FROM npcs n WHERE n.hermes_profile_id = hermes_profiles.id)`,
      )
      .run().changes;

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS npcs_appearance_conflicts AS
      SELECT n.id AS npc_id, n.hermes_profile_id, n.channel_id, n.appearance, n.updated_at
      FROM npcs n WHERE n.hermes_profile_id IS NOT NULL AND n.id <> (
        SELECT m.id FROM npcs m WHERE m.hermes_profile_id = n.hermes_profile_id
        ORDER BY m.updated_at DESC, m.created_at DESC LIMIT 1)`);

    // 4) 미연결 백업·삭제
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS npcs_unprofiled_backup AS SELECT * FROM npcs WHERE hermes_profile_id IS NULL`,
    );
    backupCascadingChildren(sqlite, "npcs_unprofiled_backup");
    const removedUnprofiled = sqlite
      .prepare(`DELETE FROM npcs WHERE hermes_profile_id IS NULL`)
      .run().changes;

    // 5) 중복 백업·삭제
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS npcs_duplicate_backup AS
      SELECT * FROM npcs n WHERE n.id <> (
        SELECT m.id FROM npcs m WHERE m.channel_id = n.channel_id AND m.hermes_profile_id = n.hermes_profile_id
        ORDER BY m.updated_at DESC, m.created_at DESC LIMIT 1)`);
    backupCascadingChildren(sqlite, "npcs_duplicate_backup");
    const removedDuplicates = sqlite
      .prepare(`DELETE FROM npcs WHERE id IN (SELECT id FROM npcs_duplicate_backup)`)
      .run().changes;

    return { moved, removedUnprofiled, removedDuplicates };
  });

  const result = prepare();

  // 6~8) 새 정의로 재생성. FK 검사는 트랜잭션 밖에서 잠시 끈다(테이블 교체 중
  // chat_messages.npc_id 등 참조가 잠깐 흔들린다) — 트랜잭션 안에서는 이 PRAGMA 가 무시된다.
  sqlite.pragma("foreign_keys = OFF");
  const rebuild = sqlite.transaction(() => {
    // 앞선 실행이 CREATE 와 DROP 사이에서 죽었으면 npcs_new 가 남아 다음 부팅을 막는다.
    sqlite.exec(`DROP TABLE IF EXISTS npcs_new`);
    sqlite.exec(`
      CREATE TABLE npcs_new (
        id TEXT PRIMARY KEY NOT NULL,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        name TEXT,
        position_x INTEGER,
        position_y INTEGER,
        direction TEXT DEFAULT 'down',
        appearance TEXT,
        adapter_type TEXT NOT NULL DEFAULT 'hermes',
        adapter_config TEXT,
        hermes_profile_id TEXT NOT NULL REFERENCES hermes_profiles(id) ON DELETE CASCADE,
        agent_config TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(channel_id, position_x, position_y),
        UNIQUE(channel_id, hermes_profile_id)
      );
      INSERT INTO npcs_new (id, channel_id, name, position_x, position_y, direction, appearance,
                            adapter_type, adapter_config, hermes_profile_id, agent_config, created_at, updated_at)
      SELECT id, channel_id, name, position_x, position_y, direction, appearance,
             adapter_type, adapter_config, hermes_profile_id, agent_config, created_at, updated_at
      FROM npcs;
      DROP TABLE npcs;
      ALTER TABLE npcs_new RENAME TO npcs;
      CREATE INDEX IF NOT EXISTS idx_npcs_channel_id ON npcs(channel_id);
    `);
  });
  try {
    rebuild();
  } finally {
    // 던지더라도 이 커넥션이 FK 검사 없이 계속 사는 일은 없어야 한다.
    sqlite.pragma("foreign_keys = ON");
  }

  // npcs 로 좁힌다 — DB 전체를 훑으면 npcs 와 무관한 낡은 고아 행 하나에 기동이 막힌다.
  const broken = sqlite.pragma("foreign_key_check(npcs)");
  if (broken.length > 0) {
    throw new Error(
      `npcs 재생성 후 외래키 무결성이 깨졌습니다(${broken.length}건): ` +
        JSON.stringify(broken.slice(0, 5)),
    );
  }

  // I4) 이미 묶인 게이트웨이의 프로필을 출근시킨다 — 유니크 제약이 생긴 **뒤**라야
  // OR IGNORE 가 먹는다. 한 번만 도는 이관의 일부라, 사용자가 나중에 재운 NPC 를
  // 되살리지 않는다(PostgreSQL 은 drizzle/0009 가 같은 일을 한다).
  if (tableExists(sqlite, "channel_gateway_bindings")) {
    sqlite.exec(`
      INSERT OR IGNORE INTO npcs (id, channel_id, hermes_profile_id, active)
      SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
             substr(lower(hex(randomblob(2))),2) || '-' ||
             substr('89ab', abs(random()) % 4 + 1, 1) ||
             substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
             b.channel_id, hp.id, 1
      FROM channel_gateway_bindings b
      JOIN hermes_profiles hp ON hp.gateway_id = b.gateway_id`);
  }

  return result;
}

module.exports = { migrateNpcsToProfileOwnership };
