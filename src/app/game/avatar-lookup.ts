/**
 * 발화자 → 외형. 말풍선·헤더의 원형 아바타가 쓴다.
 *
 * 외형은 메시지에 실려 오지 않는다 — 채널 명부(직원)와 접속자 목록(사람)에 이미 있으므로
 * 거기서 찾는다. id 로 먼저 찾고, id 가 없거나 안 맞으면 이름으로 찾는다(옛 메시지에는
 * `senderId` 가 없을 수 있다). 못 찾으면 `null` — 아바타는 기본 표시로 그려진다.
 */
export type AvatarSubject = { kind: "npc" | "user"; id?: string | null; name: string };
export type AvatarLookup = (who: AvatarSubject) => unknown;

export type AvatarNpc = { id: string; name: string; appearance?: unknown };
export type AvatarPlayer = { userId?: string | null; name: string; appearance?: unknown };

export function createAvatarLookup(
  npcs: readonly AvatarNpc[],
  players: readonly AvatarPlayer[],
): AvatarLookup {
  return (who) => {
    if (who.kind === "npc") {
      const npc =
        (who.id ? npcs.find((entry) => entry.id === who.id) : undefined) ??
        npcs.find((entry) => entry.name === who.name);
      return npc?.appearance ?? null;
    }
    const player =
      (who.id ? players.find((entry) => entry.userId === who.id) : undefined) ??
      players.find((entry) => entry.name === who.name);
    return player?.appearance ?? null;
  };
}
