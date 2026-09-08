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

function migrateNpcsToProfileOwnership(sqlite) {
  // npcs 나 hermes_profiles 가 아직 없는 DB(최소 픽스처, 신규 부트스트랩 이전 단계)에는
  // 옮길 것도 재생성할 것도 없다 — sqlite-base-schema.js 가 새 정의로 만든다.
  if (!tableExists(sqlite, "npcs") || !tableExists(sqlite, "hermes_profiles")) return null;
  if (columns(sqlite, "npcs").includes("active")) return null; // 이미 적용됨

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
    const removedUnprofiled = sqlite
      .prepare(`DELETE FROM npcs WHERE hermes_profile_id IS NULL`)
      .run().changes;

    // 5) 중복 백업·삭제
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS npcs_duplicate_backup AS
      SELECT * FROM npcs n WHERE n.id <> (
        SELECT m.id FROM npcs m WHERE m.channel_id = n.channel_id AND m.hermes_profile_id = n.hermes_profile_id
        ORDER BY m.updated_at DESC, m.created_at DESC LIMIT 1)`);
    const removedDuplicates = sqlite
      .prepare(`DELETE FROM npcs WHERE id IN (SELECT id FROM npcs_duplicate_backup)`)
      .run().changes;

    return { moved, removedUnprofiled, removedDuplicates };
  });

  const result = prepare();

  // 6~8) 새 정의로 재생성. FK 검사는 트랜잭션 밖에서 잠시 끈다(테이블 교체 중
  // tasks.npc_id 등 참조가 잠깐 흔들린다) — 트랜잭션 안에서는 이 PRAGMA 가 무시된다.
  sqlite.pragma("foreign_keys = OFF");
  const rebuild = sqlite.transaction(() => {
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
  rebuild();
  sqlite.pragma("foreign_keys = ON");

  return result;
}

module.exports = { migrateNpcsToProfileOwnership };
