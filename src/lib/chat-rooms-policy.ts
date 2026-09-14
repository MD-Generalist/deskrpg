export type ReplyPolicy = "mention" | "members";
export type RoomRow = {
  id: string;
  channelId: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  createdAt: Date;
  lastMessageAt: Date | null;
};
/**
 * 방의 한 줄. `chat-rooms.ts`(서버 전용, `@/db` 를 끈다) 가 아니라 여기 있다 —
 * 클라이언트가 이 타입을 필요로 하는데, 서버 모듈에서 `import type` 으로 가져와도
 * `client-bundle-boundary.test.ts` 의 import 추적에 걸린다.
 */
export type RoomMessage = {
  id: string;
  roomId: string;
  senderKind: "user" | "npc" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  createdAt: string;
  /** 자동화 알림(칸반 카드·크론 결과)의 구조. 일반 메시지에는 없다(R29·R30). */
  notice?: RoomNotice | null;
};

/**
 * `chat_room_messages.notice_json` 의 모양. `content` 는 로케일 무관 폴백(카드 제목·결과
 * 본문)이고, 카드 렌더링에 필요한 나머지는 여기 실린다 — 서버가 한국어 문장을 굳히지
 * 않기 위해서다(시스템 메시지와 같은 원칙).
 */
export type RoomNotice =
  | {
      kind: "card_done" | "card_blocked";
      cardId: string;
      cardTitle: string;
      boardSlug: string;
      npcName: string;
    }
  | {
      kind: "cron_result";
      jobId: string;
      jobName: string;
      npcName: string;
      status: "ok" | "error";
    };

const ROOM_NOTICE_KINDS = new Set(["card_done", "card_blocked", "cron_result"]);

/** 저장된 JSON 문자열을 되읽는다. 깨진 값·모르는 kind 는 null — 메시지 자체는 살린다. */
export function parseRoomNotice(raw: string | null | undefined): RoomNotice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    return typeof kind === "string" && ROOM_NOTICE_KINDS.has(kind) ? (parsed as RoomNotice) : null;
  } catch {
    return null;
  }
}

export type RoomSummary = {
  id: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  lastMessageAt: string | null;
  members: { kind: "user" | "npc"; id: string; name: string }[];
  lastMessage?: { senderName: string; content: string; createdAt: string };
};

/** 방 정책 × 지명 → 이번 메시지에 대답할 NPC. office(mention)는 지명만, group(members)는 전원 또는 지명된 부분집합. */
export function decideResponders(
  policy: ReplyPolicy,
  mentionedIds: string[],
  memberNpcIds: string[],
): string[] {
  const members = new Set(memberNpcIds);
  const mentioned = mentionedIds.filter((id) => members.has(id));
  if (policy === "mention") return mentioned;
  return mentionedIds.length > 0 ? mentioned : [...memberNpcIds];
}

export function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "office" ? -1 : 1;
    return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
  });
}

export type RoomAccess =
  { ok: true; room: RoomRow } | { ok: false; code: "not_found" | "forbidden" };
export function resolveRoomAccessDecision(args: {
  room: RoomRow | null;
  channelAllowed: boolean;
  isMember: boolean;
}): RoomAccess {
  if (!args.room) return { ok: false, code: "not_found" };
  if (!args.channelAllowed) return { ok: false, code: "forbidden" };
  if (args.room.kind === "group" && !args.isMember) return { ok: false, code: "forbidden" };
  return { ok: true, room: args.room };
}
