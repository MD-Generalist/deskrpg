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
