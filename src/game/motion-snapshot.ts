import type { MotionContinuation } from "../server/npc-motion-continuation";
import type { SpatialMotionTarget } from "../lib/meeting-discussion-state";
export type { MotionContinuation } from "../server/npc-motion-continuation";
export type MotionNpc = {
  npcId: string;
  x: number;
  y: number;
  direction: string;
  homeX: number;
  homeY: number;
  ownerSocketId: string | null;
  phase: "idle" | "called" | "waiting" | "returning" | "ambient";
  moving: boolean;
  revision: number;
  continuation?: MotionContinuation | null;
  spatialTarget?: SpatialMotionTarget | null;
};
export type MotionSnapshot = {
  channelId: string;
  revision: number;
  ambientLeaderId: string | null;
  npcs: MotionNpc[];
  seats: {
    seatId: string;
    actorId: string;
    ownerSocketId: string;
    x: number;
    y: number;
    spatial?: boolean;
  }[];
};
/** Retained independently from asynchronous sprite/model readiness. */
export class MotionSnapshotCache {
  current: MotionSnapshot | null = null;
  accept(snapshot: MotionSnapshot, channelId: string) {
    if (
      snapshot.channelId !== channelId ||
      (this.current && snapshot.revision < this.current.revision)
    )
      return false;
    this.current = snapshot;
    return true;
  }
  clear() {
    this.current = null;
  }
}
/** A delayed join acknowledgement must never undo player input. */
export function untouchedSpawn(
  initial: { x: number; y: number } | null,
  current: { x: number; y: number },
  inputStarted: boolean,
) {
  return (
    !!initial && !inputStarted && Math.hypot(initial.x - current.x, initial.y - current.y) < 0.5
  );
}

/** An ambient leader handoff must not cancel an unrelated active caller's route. */
export function restoreOnSnapshot(first: boolean, becameLeader: boolean, npc: MotionNpc) {
  return first || (becameLeader && !npc.ownerSocketId);
}

/** Runtime home changes must reach every return/ambient consumer, including an
 * existing sprite whose roster allocation changed after another NPC clocked in. */
export function adoptNpcMotionHome(
  npc: { homeCol: number; homeRow: number },
  state: { homeX: number; homeY: number },
): boolean {
  const col = state.homeX / 32 - 0.5,
    row = state.homeY / 32 - 0.5;
  if (!Number.isFinite(col) || !Number.isFinite(row)) return false;
  const changed = npc.homeCol !== col || npc.homeRow !== row;
  npc.homeCol = col;
  npc.homeRow = row;
  return changed;
}
