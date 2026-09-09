/**
 * 방마다, 이번 대화에 참여한 NPC 들.
 *
 * 대화방을 닫으면 곁에 있던 NPC 가 자리로 돌아가고, 사용자가 다시 메시지를 보내면
 * 그 **방의** 참여자 전원이 되돌아온다 — "누가 참여자였나" 를 패널이 닫힌 뒤에도
 * 들고 있어야 한다. 컨텍스트 메뉴로 부른 NPC 는 참여자가 아니다(그건 1:1 이다).
 *
 * 방별로 가르는 이유: 기획방에서 부른 NPC 가 office 방에 말했다고 되돌아오면 안 된다.
 */
export class MapChatParticipants {
  private readonly byRoom = new Map<string, Set<string>>();

  noteCalled(roomId: string | null | undefined, npcId: string, reason?: string): void {
    if (reason !== "map-chat" || !roomId) return;
    let ids = this.byRoom.get(roomId);
    if (!ids) {
      ids = new Set<string>();
      this.byRoom.set(roomId, ids);
    }
    ids.add(npcId);
  }

  /**
   * 사용자가 명시적으로 돌려보냈다 — 다음 메시지에 다시 부르지 않는다.
   * 돌려보내기는 맵 위의 행동이지 방 안의 행동이 아니므로 **모든 방**에서 뺀다.
   */
  dismiss(npcId: string): void {
    for (const ids of this.byRoom.values()) ids.delete(npcId);
  }

  /** 다시 부를 대상: 그 방의 참여자 중 지금 곁에 없는(자리로 돌아간) NPC. */
  recallTargets(roomId: string | null | undefined, present: ReadonlySet<string>): string[] {
    if (!roomId) return [];
    return [...(this.byRoom.get(roomId) ?? [])].filter((id) => !present.has(id));
  }
}
