-- 그룹 대화방: 채널 채팅을 "방" 으로 일반화한다(스펙 2026-09-10-그룹-대화방-설계).
-- 채널마다 kind='office' 방 하나가 지금의 채널 채팅이다. 삭제 불가·공개·@지명 정책.
-- NPC 기억 스코프가 openchat-<채널> 에서 room-<id> 로 바뀌므로 사무실 채팅의 기존 기억은 새로 시작한다.
CREATE TABLE IF NOT EXISTS "chat_rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "channels"("id") ON DELETE cascade,
  "kind" varchar(10) NOT NULL,
  "name" varchar(60) NOT NULL,
  "reply_policy" varchar(10) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_chat_rooms_channel" ON "chat_rooms" ("channel_id", "last_message_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_rooms_office_per_channel" ON "chat_rooms" ("channel_id") WHERE kind = 'office';

CREATE TABLE IF NOT EXISTS "chat_room_members" (
  "room_id" uuid NOT NULL REFERENCES "chat_rooms"("id") ON DELETE cascade,
  "member_kind" varchar(8) NOT NULL,
  "member_id" uuid NOT NULL,
  "invited_by" uuid REFERENCES "users"("id"),
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("room_id", "member_kind", "member_id")
);

CREATE TABLE IF NOT EXISTS "chat_room_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "chat_rooms"("id") ON DELETE cascade,
  "sender_kind" varchar(8) NOT NULL,
  "sender_id" uuid,
  "sender_name" varchar(100) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_chat_room_messages_room" ON "chat_room_messages" ("room_id", "created_at");

-- 백필: 채널마다 office 방 하나. 멱등.
INSERT INTO "chat_rooms" ("channel_id", "kind", "name", "reply_policy", "created_by")
SELECT c."id", 'office', 'office', 'mention', c."owner_id"
FROM "channels" c
WHERE NOT EXISTS (SELECT 1 FROM "chat_rooms" r WHERE r."channel_id" = c."id" AND r."kind" = 'office');
