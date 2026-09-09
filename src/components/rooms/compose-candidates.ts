import type { RoomSummary } from "@/lib/chat-rooms-policy";

/**
 * 초대 화면의 후보에서 **이미 그 방에 있는** NPC·사람을 뺀다.
 *
 * 걸러 내지 않으면 이미 멤버인 이름이 체크되지 않은 채로 나열돼, 고르고 초대해도
 * 아무 일이 일어나지 않는다(서버가 중복을 무시한다). "초대했는데 안 된다" 로 보인다.
 * `room` 이 없으면(새 방 만들기) 후보를 그대로 돌려준다.
 *
 * `selfUserId` 를 주면 본인은 항상 사용자 후보에서 뺀다 — 새 방이든 초대든 만든/부른 사람은
 * 이미 멤버이므로 고를 이유가 없다(새 방은 `room` 이 null 이라 멤버 필터가 안 걸린다).
 */
export function candidatesForInvite<N extends { id: string }, U extends { id: string }>(
  room: RoomSummary | null | undefined,
  npcs: N[],
  users: U[],
  selfUserId?: string | null,
): { npcs: N[]; users: U[] } {
  const withoutSelf = selfUserId ? users.filter((user) => user.id !== selfUserId) : users;
  if (!room) return { npcs, users: withoutSelf };
  const npcMembers = new Set(
    room.members.filter((member) => member.kind === "npc").map((member) => member.id),
  );
  const userMembers = new Set(
    room.members.filter((member) => member.kind === "user").map((member) => member.id),
  );
  return {
    npcs: npcs.filter((npc) => !npcMembers.has(npc.id)),
    users: withoutSelf.filter((user) => !userMembers.has(user.id)),
  };
}
