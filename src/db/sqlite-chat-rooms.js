// 그룹 대화방 테이블. 두 부트스트랩(src/db/index.ts, server-db.js)이 같이 부른다 — 한쪽에만
// 넣으면 소켓 서버가 여는 DB 에 테이블이 없어 채팅이 통째로 죽는다(2026-09 의 T2 사고와 같은 유형).
"use strict";

const CHAT_ROOM_TABLES = `
  CREATE TABLE IF NOT EXISTS chat_rooms (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    reply_policy TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_message_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chat_rooms_channel ON chat_rooms(channel_id, last_message_at);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_rooms_office_per_channel ON chat_rooms(channel_id) WHERE kind = 'office';
  CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    member_kind TEXT NOT NULL,
    member_id TEXT NOT NULL,
    invited_by TEXT REFERENCES users(id),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (room_id, member_kind, member_id)
  );
  CREATE TABLE IF NOT EXISTS chat_room_messages (
    id TEXT PRIMARY KEY NOT NULL,
    room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_kind TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room ON chat_room_messages(room_id, created_at);
`;

function tableExists(sqlite, table) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function hasColumn(sqlite, table, column) {
  return sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

/**
 * 테이블 생성 + 채널마다 office 방 백필. 멱등 — 매 부팅마다 돌아도 된다.
 * 백필은 `channels` 테이블이 있고 `owner_id` 컬럼을 갖췄을 때만 돈다 — RBAC 등이 쓰는
 * 최소 픽스처(id 뿐인 channels, 또는 channels 자체가 없는 DB)는 아직 그 모양이 아니다.
 */
function ensureChatRoomTables(sqlite) {
  sqlite.exec(CHAT_ROOM_TABLES);
  if (!tableExists(sqlite, "channels") || !hasColumn(sqlite, "channels", "owner_id")) {
    console.warn(
      "[chat-rooms] channels.owner_id 가 없어 office 방 백필을 건너뜁니다 — 이 DB 의 채널 채팅이 비어 보일 수 있습니다",
    );
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO chat_rooms (id, channel_id, kind, name, reply_policy, created_by, created_at)
       SELECT lower(hex(randomblob(16))), c.id, 'office', 'office', 'mention', c.owner_id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM channels c
       WHERE NOT EXISTS (SELECT 1 FROM chat_rooms r WHERE r.channel_id = c.id AND r.kind = 'office')`,
    )
    .run();
}

module.exports = { CHAT_ROOM_TABLES, ensureChatRoomTables };
