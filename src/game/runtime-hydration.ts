import type { MotionContinuation } from "./motion-snapshot";

export type PlayerMotionGoal = { targetX: number; targetY: number; seatId?: string };
export type PlayerSpawnState = {
  x: number;
  y: number;
  direction?: string;
  animation?: string;
  restored?: boolean;
  motion?: PlayerMotionGoal | null;
};

/** Preserve only an intentional click goal; a stale keyboard walk must not keep moving. */
export function playerMotionGoal(
  path: readonly { x: number; y: number }[] | null,
  seatId: string | null,
  tileSize: number,
): PlayerMotionGoal | null {
  const goal = path?.at(-1);
  if (goal)
    return {
      targetX: (goal.x + 0.5) * tileSize,
      targetY: (goal.y + 0.5) * tileSize,
      ...(seatId ? { seatId } : {}),
    };
  if (seatId) {
    const [targetX, targetY] = seatId.split(":").map(Number);
    if (Number.isFinite(targetX) && Number.isFinite(targetY)) return { targetX, targetY, seatId };
  }
  return null;
}

/** Restored values must not share mutable schedules/paths with the accepted snapshot. */
export function copyMotionContinuation(state: MotionContinuation): MotionContinuation {
  return {
    ambientSchedule: {
      ...state.ambientSchedule,
      ...(state.ambientSchedule.seatTarget
        ? { seatTarget: { ...state.ambientSchedule.seatTarget } }
        : {}),
    },
    ...(state.ambientSeat ? { ambientSeat: { ...state.ambientSeat } } : {}),
    ambientTimer: state.ambientTimer ?? 0,
    path: state.path?.map((point) => ({ ...point })),
  };
}
