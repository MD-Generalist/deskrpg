export function ambientLeader(localId: string | undefined, remoteIds: string[]) {
  return !!localId && [localId, ...remoteIds].sort()[0] === localId;
}
export function ambientAllowed(busy: boolean, dialogOpen: boolean, called: boolean) {
  return !busy && !dialogOpen && !called;
}
export type AmbientPoint = { x: number; y: number };
export type AmbientSchedule = {
  phase: "rest" | "roam" | "home";
  elapsed: number;
  duration: number;
  pause: number;
  seatTarget?: AmbientPoint;
  seatRest?: number;
  visitedSeat?: boolean;
};
export const randomDuration = (min: number, max: number, random = Math.random) =>
  min + random() * (max - min);
export function createAmbientSchedule(random = Math.random): AmbientSchedule {
  return { phase: "rest", elapsed: 0, duration: randomDuration(60000, 100000, random), pause: 0 };
}
/** Called only while autonomous movement is allowed; conversations pause this clock. */
export function advanceAmbientSchedule(
  state: AmbientSchedule,
  delta: number,
  atHome: boolean,
  random = Math.random,
  canDepart = true,
) {
  state.elapsed += Math.max(0, Math.min(delta, 100));
  if (state.phase === "rest" && !atHome) {
    Object.assign(state, { phase: "home", elapsed: 0, pause: 0 });
  } else if (state.phase === "home" && atHome) {
    delete state.seatTarget;
    delete state.seatRest;
    delete state.visitedSeat;
    Object.assign(state, createAmbientSchedule(random));
  } else if (state.phase === "rest" && state.elapsed >= state.duration && canDepart) {
    Object.assign(state, {
      phase: "roam",
      elapsed: 0,
      duration: randomDuration(20000, 35000, random),
      pause: 0,
    });
  } else if (state.phase === "roam" && state.elapsed >= state.duration) {
    Object.assign(state, { phase: "home", elapsed: 0, pause: 0 });
  }
}
/** Uniform shuffled destinations across the map. Reachability is checked by the caller. */
export function ambientDestinations(
  width: number,
  height: number,
  current: AmbientPoint,
  walkable: (x: number, y: number) => boolean,
  random = Math.random,
): AmbientPoint[] {
  const points: AmbientPoint[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if ((x !== current.x || y !== current.y) && walkable(x, y)) points.push({ x, y });
    }
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  return points;
}
/** Stable nearest free chair, with configured home as fallback when no chair exists. */
export function ambientHome(home: AmbientPoint, seats: AmbientPoint[], reserved: AmbientPoint[]) {
  return (
    seats
      .filter((s) => !reserved.some((r) => r.x === s.x && r.y === s.y))
      .sort(
        (a, b) =>
          Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y) ||
          a.y - b.y ||
          a.x - b.x,
      )[0] ?? home
  );
}

/** One shared departure gate; returning and paused walkers retain their slot. */
export class AmbientDepartures {
  private nextDeparture = 0;
  canDepart(now: number, activeCount: number) {
    return activeCount < 2 && now >= this.nextDeparture;
  }
  departed(now: number, random = Math.random) {
    this.nextDeparture = now + randomDuration(15000, 25000, random);
  }
}

/** Arrival starts the full break; its time does not consume the short walking budget. */
export function restAtAmbientSeat(
  state: AmbientSchedule,
  position: AmbientPoint,
  walking: boolean,
  delta: number,
  random = Math.random,
) {
  if (state.phase !== "roam") {
    delete state.seatTarget;
    delete state.seatRest;
    return false;
  }
  if (state.seatTarget && !walking) {
    const arrived =
      Math.hypot(position.x - state.seatTarget.x, position.y - state.seatTarget.y) < 0.1;
    delete state.seatTarget;
    if (arrived) {
      state.seatRest = randomDuration(8000, 16000, random);
      state.pause = 0;
    }
  }
  if (!state.seatRest) return false;
  state.seatRest = Math.max(0, state.seatRest - Math.max(0, Math.min(delta, 100)));
  return true;
}
