import { getWalkPhase } from "./commute-motion";

/** Homepage-only opt-in. Other actor callers retain the original animation clock. */
export interface DistanceWalkOptions {
  distanceWalk?: boolean;
}
export interface DistanceWalkFrame {
  cumulativeDistance: number;
}
/** Real GLBs, 240 samples/cycle, median backwards toe velocity within 2.5cm
 * of minimum foot height. Values average left/right contact travel per cycle.
 * All clips last 1.041666627s; heights are 1.900m (male) / 1.916m (female).
 * Left/right metres: Jun 1.8296/1.8421, Seo 1.9193/1.7407,
 * Yun/Eun 1.9187/1.7402, Roan 1.8151/1.8275, Min 1.9144/1.9280.
 * Largest per-foot residual is 5.13%; root world scale is applied by the actor.
 */
export const COMMUTE_WALK_STRIDES: Readonly<Record<string, number>> = {
  "office-jun": 1.83583,
  "office-seo": 1.83004,
  "office-yun": 1.82948,
  "office-eun": 1.82948,
  "office-roan": 1.82131,
  "office-min": 1.9212,
};
/** Two 0.405m leg segments plus the 0.036m sole offset, ±0.32rad excursion. */
export const MINIATURE_WALK_STRIDE = 4 * 0.846 * Math.sin(0.32);
/** Linear backwards sole travel during stance; bent knee belongs to swing only. */
export function miniatureDistancePose(phase: number) {
  const triangle = (2 / Math.PI) * Math.asin(Math.sin(phase));
  return {
    leg: Math.asin(triangle * Math.sin(0.32)),
    knee: Math.max(0, -Math.cos(phase)) * 0.4,
  };
}

/** Integrate distance into cycles so switching asset/scale never resets foot phase. */
export function createDistanceWalkPhase() {
  let previous = 0,
    cycles = 0;
  return (distance: number, stride: number) => {
    if (!Number.isFinite(distance) || distance < previous)
      throw new RangeError("walk distance must be finite and nondecreasing");
    getWalkPhase(0, stride);
    cycles += (distance - previous) / stride;
    previous = distance;
    return getWalkPhase(cycles, 1);
  };
}

/** Distance excludes path-wrap teleports. Feed every clock tick, including pauses. */
export function createCommuteWalker(speed = 0.58) {
  if (!Number.isFinite(speed) || speed < 0) throw new RangeError("speed must be nonnegative");
  let previous: number | undefined;
  const state: DistanceWalkFrame = { cumulativeDistance: 0 };
  return {
    update(time: number, moving = true): DistanceWalkFrame {
      if (!Number.isFinite(time)) throw new RangeError("time must be finite");
      const dt = previous === undefined ? 0 : Math.max(0, time - previous);
      previous = time;
      if (moving) state.cumulativeDistance += speed * dt;
      return state;
    },
  };
}
