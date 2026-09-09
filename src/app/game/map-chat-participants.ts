/**
 * 이번 그룹 채팅에 참여한 NPC 들.
 *
 * 채널 채팅을 닫으면 곁에 있던 NPC 가 자리로 돌아가고, 사용자가 다시 메시지를 보내면
 * 참여자 전원이 되돌아온다 — "누가 참여자였나" 를 패널이 닫힌 뒤에도 들고 있어야 한다.
 * 컨텍스트 메뉴로 부른 NPC 는 참여자가 아니다(그건 1:1 이다).
 */
export class MapChatParticipants {
  private readonly ids = new Set<string>();

  noteCalled(npcId: string, reason?: string): void {
    if (reason === "map-chat") this.ids.add(npcId);
  }

  /** 사용자가 명시적으로 돌려보냈다 — 다음 메시지에 다시 부르지 않는다. */
  dismiss(npcId: string): void {
    this.ids.delete(npcId);
  }

  /** 다시 부를 대상: 참여자 중 지금 곁에 없는(자리로 돌아간) NPC. */
  recallTargets(present: ReadonlySet<string>): string[] {
    return [...this.ids].filter((id) => !present.has(id));
  }
}
