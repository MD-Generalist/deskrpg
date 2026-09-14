import type { MotionSnapshot } from "../../game/motion-snapshot";

/** Local arrival/return events cannot overrule a rejoined server owner and phase. */
export function npcMotionUi(
  snapshot: MotionSnapshot | null,
  npcId: string | undefined,
  fallbackPhase?: string,
  fallbackCaller?: string,
) {
  const npc = snapshot?.npcs.find((entry) => entry.npcId === npcId);
  if (!npc) return { phase: fallbackPhase, caller: fallbackCaller };
  return {
    phase:
      npc.phase === "called" ? "moving-to-player" : npc.phase === "ambient" ? "idle" : npc.phase,
    caller: npc.phase === "ambient" ? undefined : (npc.ownerSocketId ?? undefined),
  };
}
