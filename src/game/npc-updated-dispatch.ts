/**
 * `npc:updated` 소켓 이벤트에는 **두 가지 모양**이 흘러 다닌다.
 *
 * - 옛 모양 `{ npcId, name?, direction?, appearance? }` — 외형·방향 편집이 보낸다
 *   (`socket-handlers.ts`).
 * - 새 모양 `{ npc: ProjectedNpc }` — 출근부 토글이 보낸다(`npc-roster-socket.ts`).
 *
 * 씬의 리스너가 `data.npcId` 만 보던 동안 새 모양은 **조용히 무시**됐다. 퇴근시킨
 * NPC 가 다른 사람 화면에 그대로 서 있었고, 아무 오류도 나지 않았다. 그래서 판단을
 * 시뮬레이션 밖 순수 함수로 빼 둔다 — 소켓 없이 node 에서 판단만 검사할 수 있다.
 */

export type LegacyNpcUpdatedPayload = {
  npcId?: string;
  name?: string;
  direction?: string;
  appearance?: unknown;
};

export type ProjectedNpcLike = {
  id: string;
  name: string;
  positionX: number | null;
  positionY: number | null;
  direction: string | null;
  appearance?: unknown;
  active: boolean;
};

export type NpcUpdatedPayload = LegacyNpcUpdatedPayload & { npc?: ProjectedNpcLike | null };

export type NpcUpdatedAction =
  | { kind: "ignore" }
  | { kind: "remove"; npcId: string }
  | {
      kind: "update";
      npcId: string;
      fields: { name?: string; direction?: string; appearance?: unknown };
    }
  | {
      kind: "spawn";
      npc: {
        id: string;
        name: string;
        positionX: number;
        positionY: number;
        direction: string;
        appearance?: unknown;
      };
    };

/**
 * @param hasSprite 그 id 의 스프라이트가 씬에 이미 있는가.
 */
export function decideNpcUpdate(
  data: NpcUpdatedPayload | null | undefined,
  hasSprite: (npcId: string) => boolean,
): NpcUpdatedAction {
  if (!data) return { kind: "ignore" };

  const npc = data.npc;
  if (npc) {
    if (!npc.id) return { kind: "ignore" };
    // 퇴근했거나 자리를 잃은 NPC 는 맵에서 뺀다. 자리가 없는 NPC 를 그리면
    // 좌표가 null 이라 스프라이트가 NaN 위치로 간다.
    if (!npc.active || npc.positionX === null || npc.positionY === null) {
      return { kind: "remove", npcId: npc.id };
    }
    if (hasSprite(npc.id)) {
      return {
        kind: "update",
        npcId: npc.id,
        fields: {
          name: npc.name,
          direction: npc.direction ?? undefined,
          appearance: npc.appearance,
        },
      };
    }
    return {
      kind: "spawn",
      npc: {
        id: npc.id,
        name: npc.name,
        positionX: npc.positionX,
        positionY: npc.positionY,
        direction: npc.direction || "down",
        appearance: npc.appearance,
      },
    };
  }

  if (!data.npcId || !hasSprite(data.npcId)) return { kind: "ignore" };
  return {
    kind: "update",
    npcId: data.npcId,
    fields: { name: data.name, direction: data.direction, appearance: data.appearance },
  };
}
