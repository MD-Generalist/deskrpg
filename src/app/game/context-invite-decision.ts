import type { RoomSummary } from "@/lib/chat-rooms-policy";

/**
 * NPC 우클릭 "그룹 대화로 초대" 가 기존 방에 끼워 넣을지, 새로 작성 화면을 열지 결정한다.
 *
 * 방이 group 이어도 채널 채팅 패널이 접혀 있으면(=사용자가 그 방을 보고 있지 않으면)
 * 초대하지 않는다 — 보이지 않는 방에 조용히 초대되는 것을 막기 위해서다. `channelChatVisible`
 * 은 패널이 열려 있고 room 뷰일 때만 true 다(`ChatPanel` 이 판정).
 */
export type ContextInviteDecision =
  | { kind: "invite"; roomId: string }
  | { kind: "already-member"; roomId: string }
  | { kind: "compose" };

export function decideContextInvite(args: {
  visible: boolean;
  currentRoom: RoomSummary | null | undefined;
  /** 초대 대상 NPC — 이미 그 방 멤버면 조용한 no-op 대신 알린다. */
  npcId?: string;
}): ContextInviteDecision {
  const { visible, currentRoom, npcId } = args;
  if (visible && currentRoom?.kind === "group") {
    const alreadyMember =
      npcId != null &&
      currentRoom.members.some((member) => member.kind === "npc" && member.id === npcId);
    if (alreadyMember) return { kind: "already-member", roomId: currentRoom.id };
    return { kind: "invite", roomId: currentRoom.id };
  }
  return { kind: "compose" };
}
