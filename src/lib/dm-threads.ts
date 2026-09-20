// 직원과의 1:1 대화(DM)를 **대화 목록에 올리기 위한** 정책.
//
// DM 은 방(`chat_rooms`)이 아니라 `chat_messages` 의 (character_id, npc_id) 쌍이다.
// 기록은 남는데 목록에 입구가 없어서, 패널을 닫으면 맵에서 그 직원을 다시 찾아
// 호출해야만 이어서 말할 수 있었다. 여기서 그 쌍을 "대화 한 줄" 로 환산한다.
//
// DB 에 닿는 부분은 `npc-chat-history.ts` 에 있고, 이 파일은 순수 함수만 둔다.

export type DmThreadRow = {
  npcId: string;
  role: string;
  content: string;
  createdAt: Date | null;
};

export type DmThread = {
  npcId: string;
  /** 목록 미리보기에 쓰는 마지막 발화. 누가 말했는지까지 보여 준다. */
  lastMessage: { role: "player" | "npc"; content: string };
  lastAt: number;
};

/**
 * 같은 직원의 여러 행을 한 줄로 접는다 — 마지막 발화만 남기고 최신순으로 세운다.
 *
 * 시각이 없는 행(`createdAt` null)도 버리지 않는다. 순서는 조회에서 이미 정해졌고
 * 여기서 잃을 것은 표시용 시각뿐이다 — `toHistoryMessages` 와 같은 판단이다.
 */
export function summarizeDmThreads(rows: DmThreadRow[]): DmThread[] {
  const byNpc = new Map<string, DmThread>();
  for (const row of rows) {
    if (row.role !== "player" && row.role !== "npc") continue;
    const content = row.content.trim();
    if (!content) continue;
    const at = row.createdAt ? row.createdAt.getTime() : 0;
    const current = byNpc.get(row.npcId);
    // 같은 시각이면 나중에 읽은 행이 이긴다 — 조회가 오름차순이므로 그게 마지막 발화다.
    if (current && current.lastAt > at) continue;
    byNpc.set(row.npcId, {
      npcId: row.npcId,
      lastMessage: { role: row.role, content },
      lastAt: at,
    });
  }
  return [...byNpc.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export type DmThreadNpc = { id: string; name: string; active: boolean };

export type DmThreadEntry = DmThread & { npcName: string; active: boolean };

/**
 * 목록에 그릴 줄을 만든다.
 *
 * **퇴근한 직원은 감추지 않는다** — 기록은 사용자의 것이고, 감추면 지금 고치는 결함
 * (입구가 없어 맵으로 돌아가야 하는 것)을 그대로 되살린다. 비활성으로 표시하고 읽게 둔다.
 * 반면 **명단에 아예 없는 직원은 뺀다** — 삭제되면 `chat_messages` 도 함께 지워지므로
 * (schema 의 onDelete: cascade) 여기 남은 것은 낡은 목록뿐이다.
 */
export function buildDmThreadEntries(threads: DmThread[], npcs: DmThreadNpc[]): DmThreadEntry[] {
  const known = new Map(npcs.map((npc) => [npc.id, npc]));
  const entries: DmThreadEntry[] = [];
  for (const thread of threads) {
    const npc = known.get(thread.npcId);
    if (!npc) continue;
    entries.push({ ...thread, npcName: npc.name, active: npc.active });
  }
  return entries;
}

/**
 * 목록에서 연 DM 에 메시지를 보낼 때 그 직원을 호출해야 하는가.
 *
 * 단테 지시: **여는 것만으로는 호출하지 않고, 보내는 시점에 호출한다.** 이미 곁에 있거나
 * 오는 중이면 다시 부르지 않는다 — 방 대화(`handleRoomSend`)가 쓰는 판정과 같은 규칙이다.
 */
export function needsCallBeforeDmSend(moveState: string | undefined | null): boolean {
  return moveState !== "waiting" && moveState !== "moving-to-player";
}
