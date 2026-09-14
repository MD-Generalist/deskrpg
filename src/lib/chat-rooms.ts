import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  chatRooms,
  chatRoomMembers,
  chatRoomMessages,
  channels,
  users,
  npcs,
  hermesProfiles,
  nowForDb,
} from "@/db";
import { isUniqueViolation } from "./db-unique-violation";
import { uuidv7 } from "./uuid-v7";
import { projectNpcRow } from "./npc-projection";
import {
  parseRoomNotice,
  sortRooms,
  type ReplyPolicy,
  type RoomMessage,
  type RoomNotice,
  type RoomSummary,
} from "./chat-rooms-policy";

export type { RoomMessage, RoomNotice, RoomRow } from "./chat-rooms-policy";
import type { RoomRow } from "./chat-rooms-policy";

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function toRoomRow(row: typeof chatRooms.$inferSelect): RoomRow {
  return {
    id: row.id,
    channelId: row.channelId,
    kind: row.kind as RoomRow["kind"],
    name: row.name,
    replyPolicy: row.replyPolicy as ReplyPolicy,
    createdBy: row.createdBy,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string),
    lastMessageAt: row.lastMessageAt
      ? row.lastMessageAt instanceof Date
        ? row.lastMessageAt
        : new Date(row.lastMessageAt as unknown as string)
      : null,
  };
}

function toRoomMessage(row: typeof chatRoomMessages.$inferSelect): RoomMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    senderKind: row.senderKind as RoomMessage["senderKind"],
    senderId: row.senderId ?? null,
    senderName: row.senderName,
    content: row.content,
    createdAt: toIso(row.createdAt as unknown as Date | string)!,
    notice: parseRoomNotice(row.noticeJson),
  };
}

/** office 방은 채널당 하나. 없으면 만들고, 유니크 위반이면(경합) 재조회한다. */
export async function ensureOfficeRoom(channelId: string, ownerId: string): Promise<RoomRow> {
  const [existing] = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.channelId, channelId), eq(chatRooms.kind, "office")))
    .limit(1);
  if (existing) return toRoomRow(existing);

  try {
    const [created] = await db
      .insert(chatRooms)
      .values({
        channelId,
        kind: "office",
        name: "오피스",
        replyPolicy: "mention",
        createdBy: ownerId,
      })
      .returning();
    return toRoomRow(created);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [row] = await db
      .select()
      .from(chatRooms)
      .where(and(eq(chatRooms.channelId, channelId), eq(chatRooms.kind, "office")))
      .limit(1);
    if (!row) throw err;
    return toRoomRow(row);
  }
}

/**
 * office 방의 `created_by` 는 **채널 소유자**여야 한다(스펙 ①). 방을 만드는 계기는
 * 아무나 부를 수 있는 `room:list` 라서, 부른 사람을 그대로 쓰면 마이그레이션 이전
 * 채널에 처음 들어온 손님이 사무실 방의 주인이 된다.
 */
export async function getChannelOwnerId(channelId: string): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return row?.ownerId ?? null;
}

export async function getRoom(roomId: string): Promise<RoomRow | null> {
  const [row] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId)).limit(1);
  return row ? toRoomRow(row) : null;
}

export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(
      and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.memberKind, "user"),
        eq(chatRoomMembers.memberId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function memberDisplayNames(
  roomIds: string[],
): Promise<Map<string, { kind: "user" | "npc"; id: string; name: string }[]>> {
  const result = new Map<string, { kind: "user" | "npc"; id: string; name: string }[]>();
  if (roomIds.length === 0) return result;

  const members = await db
    .select()
    .from(chatRoomMembers)
    .where(inArray(chatRoomMembers.roomId, roomIds));

  const userIds = [
    ...new Set(members.filter((m) => m.memberKind === "user").map((m) => m.memberId)),
  ];
  const npcIds = [...new Set(members.filter((m) => m.memberKind === "npc").map((m) => m.memberId))];

  const userNames = new Map<string, string>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const r of rows) userNames.set(r.id, r.nickname);
  }

  const npcNames = new Map<string, string>();
  if (npcIds.length > 0) {
    const rows = await db
      .select({ npc: npcs, profile: hermesProfiles })
      .from(npcs)
      .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
      .where(inArray(npcs.id, npcIds));
    for (const r of rows) {
      const projected = projectNpcRow(r.npc, r.profile, "");
      npcNames.set(r.npc.id, projected.name);
    }
  }

  for (const m of members) {
    const list = result.get(m.roomId) ?? [];
    const name =
      m.memberKind === "user"
        ? (userNames.get(m.memberId) ?? m.memberId)
        : (npcNames.get(m.memberId) ?? m.memberId);
    list.push({ kind: m.memberKind as "user" | "npc", id: m.memberId, name });
    result.set(m.roomId, list);
  }
  return result;
}

/**
 * 방마다 최신 메시지 1건 — 방 개수만큼 쿼리를 날리던 N+1 을 단일 쿼리로 줄인다.
 * "이 행보다 (created_at, id) 사전식으로 더 뒤인 같은 방 행이 없다" 는 상관
 * 서브쿼리(NOT EXISTS)로 방마다 최신 행 하나만 골라낸다 — PG/SQLite 모두 표준
 * SQL 이라 방언 분기가 필요 없다. 같은 방·같은 타임스탬프로 쓰인 메시지가 있으면
 * (SQLite 의 created_at 은 밀리초라 흔하다) id 가 더 큰 쪽을 최신으로 친다 —
 * `appendRoomMessage` 가 **UUIDv7**(앞 48비트가 유닉스 밀리초 + 같은 밀리초 안에서는
 * 단조 증가 카운터)을 박아 넣으므로 id 순서가 곧 생성 순서다. v4 이던 시절에는 이 규칙이
 * 승자를 무작위로 골랐다.
 * 서브쿼리 안의 `chat_room_messages`/컬럼명은 raw SQL 이지만 사용자 입력이 섞이지
 * 않는 고정 문자열이라 바인딩 안전성 문제가 없다.
 */
async function lastMessages(roomIds: string[]): Promise<Map<string, RoomMessage>> {
  const result = new Map<string, RoomMessage>();
  if (roomIds.length === 0) return result;

  const rows = await db
    .select()
    .from(chatRoomMessages)
    .where(
      and(
        inArray(chatRoomMessages.roomId, roomIds),
        sql`NOT EXISTS (
          SELECT 1 FROM chat_room_messages m2
          WHERE m2.room_id = chat_room_messages.room_id
            AND (
              m2.created_at > chat_room_messages.created_at
              OR (m2.created_at = chat_room_messages.created_at AND m2.id > chat_room_messages.id)
            )
        )`,
      ),
    );

  for (const row of rows) result.set(row.roomId, toRoomMessage(row));
  return result;
}

function toSummary(
  room: RoomRow,
  membersByRoom: Map<string, { kind: "user" | "npc"; id: string; name: string }[]>,
  lastByRoom: Map<string, RoomMessage>,
): RoomSummary {
  const last = lastByRoom.get(room.id);
  return {
    id: room.id,
    kind: room.kind,
    name: room.name,
    replyPolicy: room.replyPolicy,
    createdBy: room.createdBy,
    lastMessageAt: toIso(room.lastMessageAt) ?? toIso(room.createdAt),
    members: membersByRoom.get(room.id) ?? [],
    ...(last
      ? {
          lastMessage: {
            senderName: last.senderName,
            content: last.content,
            createdAt: last.createdAt,
          },
        }
      : {}),
  };
}

/** office 1개 + 내가 user 멤버인 group 전체. */
export async function listRoomsForUser(channelId: string, userId: string): Promise<RoomSummary[]> {
  const office = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.channelId, channelId), eq(chatRooms.kind, "office")))
    .limit(1);

  const myGroupMemberships = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.memberKind, "user"), eq(chatRoomMembers.memberId, userId)));
  const myRoomIds = myGroupMemberships.map((m) => m.roomId);

  const groups =
    myRoomIds.length === 0
      ? []
      : await db
          .select()
          .from(chatRooms)
          .where(
            and(
              eq(chatRooms.channelId, channelId),
              eq(chatRooms.kind, "group"),
              inArray(chatRooms.id, myRoomIds),
            ),
          );

  const rooms = [...office, ...groups].map(toRoomRow);
  const roomIds = rooms.map((r) => r.id);
  const [membersByRoom, lastByRoom] = await Promise.all([
    memberDisplayNames(roomIds),
    lastMessages(roomIds),
  ]);
  const summaries = rooms.map((r) => toSummary(r, membersByRoom, lastByRoom));
  return sortRooms(summaries);
}

/** `name` 이 빈 문자열이면 NPC 이름을 이어 붙인다(최대 60자). createdBy 는 자동으로 user 멤버가 된다. */
export async function createRoom(args: {
  channelId: string;
  name: string;
  createdBy: string;
  npcIds: string[];
  userIds: string[];
}): Promise<RoomRow> {
  let name = args.name.trim();
  if (!name) {
    const npcRows =
      args.npcIds.length === 0
        ? []
        : await db
            .select({ npc: npcs, profile: hermesProfiles })
            .from(npcs)
            .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
            .where(inArray(npcs.id, args.npcIds));
    const names = npcRows.map((r) => projectNpcRow(r.npc, r.profile, "").name);
    name = (names.join(", ") || "새 대화방").slice(0, 60);
  }

  const [created] = await db
    .insert(chatRooms)
    .values({
      channelId: args.channelId,
      kind: "group",
      name,
      replyPolicy: "members",
      createdBy: args.createdBy,
    })
    .returning();

  const userIds = [...new Set([args.createdBy, ...args.userIds])];
  await addMembers(created.id, args.createdBy, args.npcIds, userIds);

  return toRoomRow(created);
}

/** 중복은 무시한다. */
export async function addMembers(
  roomId: string,
  invitedBy: string,
  npcIds: string[],
  userIds: string[],
): Promise<void> {
  const existing = await db
    .select({ memberKind: chatRoomMembers.memberKind, memberId: chatRoomMembers.memberId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId));
  const existingKeys = new Set(existing.map((m) => `${m.memberKind}:${m.memberId}`));

  const rows: (typeof chatRoomMembers.$inferInsert)[] = [];
  for (const id of npcIds) {
    if (existingKeys.has(`npc:${id}`)) continue;
    existingKeys.add(`npc:${id}`);
    rows.push({ roomId, memberKind: "npc", memberId: id, invitedBy });
  }
  for (const id of userIds) {
    if (existingKeys.has(`user:${id}`)) continue;
    existingKeys.add(`user:${id}`);
    rows.push({ roomId, memberKind: "user", memberId: id, invitedBy });
  }
  if (rows.length === 0) return;
  await db.insert(chatRoomMembers).values(rows);
}

export async function removeUserMember(roomId: string, userId: string): Promise<void> {
  await db
    .delete(chatRoomMembers)
    .where(
      and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.memberKind, "user"),
        eq(chatRoomMembers.memberId, userId),
      ),
    );
}

export async function renameRoom(roomId: string, name: string): Promise<void> {
  await db.update(chatRooms).set({ name }).where(eq(chatRooms.id, roomId));
}

export async function deleteRoom(roomId: string): Promise<void> {
  await db.delete(chatRooms).where(eq(chatRooms.id, roomId));
}

export async function roomNpcMemberIds(roomId: string): Promise<string[]> {
  const rows = await db
    .select({ memberId: chatRoomMembers.memberId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.memberKind, "npc")));
  return rows.map((r) => r.memberId);
}

/**
 * insert 후 방의 last_message_at 을 갱신한다.
 * `notice` 는 자동화 알림의 구조(R29·R30) — JSON 으로 `notice_json` 에 남고 `RoomMessage.notice`
 * 로 되읽힌다. 일반 메시지는 넘기지 않는다(NULL).
 */
export async function appendRoomMessage(args: {
  roomId: string;
  senderKind: "user" | "npc" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  notice?: RoomNotice | null;
}): Promise<RoomMessage> {
  const [created] = await db
    .insert(chatRoomMessages)
    .values({
      // DB 기본값(randomUUID / defaultRandom)은 v4 라 정렬 키가 되지 못한다.
      // 방언 양쪽에서 같은 규칙을 쓰도록 앱에서 박는다.
      id: uuidv7(),
      roomId: args.roomId,
      senderKind: args.senderKind,
      senderId: args.senderId,
      senderName: args.senderName,
      content: args.content,
      noticeJson: args.notice ? JSON.stringify(args.notice) : null,
    })
    .returning();
  await db
    .update(chatRooms)
    .set({ lastMessageAt: nowForDb() })
    .where(eq(chatRooms.id, args.roomId));
  return toRoomMessage(created);
}

/**
 * 최근 `limit` 개를 오래된 순으로 돌려준다.
 *
 * 정렬은 `(created_at, id)` 사전식 — `lastMessages()` 의 상관 서브쿼리와 **같은 규칙**이다.
 * 두 함수가 다른 규칙을 쓰면 목록의 "마지막 메시지" 와 방을 열었을 때의 마지막 줄이
 * 어긋난다. id 가 UUIDv7 이라 이 타이브레이커는 생성 순서와 일치한다.
 *
 * v7 도입 이전에 쌓인 행은 v4 라 그들끼리의 동률은 여전히 무작위다 — 새 메시지에는
 * 영향이 없고, 옛 대화의 한 밀리초 안 순서가 흔들릴 뿐이다.
 */
export async function recentRoomMessages(roomId: string, limit: number): Promise<RoomMessage[]> {
  const rows = await db
    .select()
    .from(chatRoomMessages)
    .where(eq(chatRoomMessages.roomId, roomId))
    .orderBy(desc(chatRoomMessages.createdAt), desc(chatRoomMessages.id))
    .limit(limit);
  return rows.reverse().map(toRoomMessage);
}
