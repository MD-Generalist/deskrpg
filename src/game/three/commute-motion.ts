/** Pure, deterministic traffic model. Distances are world units; times are seconds. */
export type VehicleKind = "sedan" | "suv" | "taxi" | "van" | "bus";
export interface VehicleSpec {
  id: string;
  kind: VehicleKind;
  direction: 1 | -1;
  laneZ: number;
  length: number;
  wheelRadius: number;
  x: number;
}
export interface VehicleState extends VehicleSpec {
  speed: number;
  opacity: number;
  active: boolean;
  /** Unsigned actual travel, excluding wrap teleports. */
  cumulativeDistance: number;
  wheelRotation: number;
}
export const DEFAULT_COMMUTE_FLEET: readonly VehicleSpec[] = [
  {
    id: "sedan-east",
    kind: "sedan",
    direction: 1,
    laneZ: 4.4,
    length: 3.1,
    wheelRadius: 0.3,
    x: 10,
  },
  { id: "taxi-east", kind: "taxi", direction: 1, laneZ: 4.4, length: 3.1, wheelRadius: 0.3, x: -5 },
  { id: "bus-east", kind: "bus", direction: 1, laneZ: 4.4, length: 6, wheelRadius: 0.38, x: -14 },
  {
    id: "suv-west",
    kind: "suv",
    direction: -1,
    laneZ: 7.2,
    length: 3.5,
    wheelRadius: 0.34,
    x: -10,
  },
  { id: "van-west", kind: "van", direction: -1, laneZ: 7.2, length: 4, wheelRadius: 0.32, x: 5 },
  {
    id: "sedan-west",
    kind: "sedan",
    direction: -1,
    laneZ: 7.2,
    length: 3.1,
    wheelRadius: 0.3,
    x: 14,
  },
];
export interface CommuteMotionOptions {
  fleet?: readonly VehicleSpec[];
  driveSeconds?: number;
  stopSeconds?: number;
  roadMin?: number;
  roadMax?: number;
  crossingX?: number;
  crossingWidth?: number;
  stopMargin?: number;
  gap?: number;
  maxSpeed?: number;
  acceleration?: number;
  deceleration?: number;
  fadeDistance?: number;
}
export function getWalkPhase(cumulativeDistance: number, stride: number): number {
  if (!Number.isFinite(stride) || stride <= 0) throw new RangeError("stride must be positive");
  return ((((cumulativeDistance / stride) % 1) + 1) % 1) * Math.PI * 2;
}
const FIXED_DT = 1 / 120;
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

export function createCommuteMotion(options: CommuteMotionOptions = {}) {
  const o = {
    driveSeconds: 12,
    stopSeconds: 4,
    roadMin: -19,
    roadMax: 19,
    crossingX: 2.4,
    crossingWidth: 2.7,
    stopMargin: 0.35,
    gap: 0.8,
    maxSpeed: 2.8,
    acceleration: 1.4,
    deceleration: 2.5,
    fadeDistance: 3,
    ...options,
  };
  for (const key of [
    "driveSeconds",
    "stopSeconds",
    "gap",
    "maxSpeed",
    "acceleration",
    "deceleration",
    "fadeDistance",
    "crossingWidth",
  ] as const) {
    if (!Number.isFinite(o[key]) || o[key] <= 0) throw new RangeError(`${key} must be positive`);
  }
  if (
    ![o.roadMin, o.roadMax, o.crossingX, o.stopMargin].every(Number.isFinite) ||
    !(o.roadMax > o.roadMin) ||
    o.stopMargin < 0
  )
    throw new RangeError("road and crossing geometry must be finite and ordered");
  const vehicles: VehicleState[] = (options.fleet ?? DEFAULT_COMMUTE_FLEET).map((v) => {
    if (
      ![v.length, v.wheelRadius, v.x, v.laneZ].every(Number.isFinite) ||
      !(v.length > 0 && v.wheelRadius > 0) ||
      ![1, -1].includes(v.direction)
    )
      throw new RangeError("invalid vehicle geometry");
    return { ...v, speed: 0, opacity: 0, active: true, cumulativeDistance: 0, wheelRotation: 0 };
  });
  if (new Set(vehicles.map((v) => v.id)).size !== vehicles.length)
    throw new RangeError("vehicle ids must be unique");
  for (const direction of [1, -1]) {
    const lane = vehicles
      .filter((v) => v.direction === direction)
      .sort((a, b) => direction * (a.x - b.x));
    for (let i = 1; i < lane.length; i++) {
      if (
        direction * (lane[i].x - lane[i - 1].x) - (lane[i].length + lane[i - 1].length) / 2 <
        o.gap - 1e-9
      )
        throw new RangeError("initial vehicle bodies must leave the configured bumper gap");
    }
  }
  let ticks = 0,
    requestedTime = 0,
    previousTime: number | undefined;
  const red = () => (ticks * FIXED_DT) % (o.driveSeconds + o.stopSeconds) >= o.driveSeconds;
  const position = (v: VehicleState) => v.direction * v.x;
  const entry = (v: VehicleState) => (v.direction === 1 ? o.roadMin : -o.roadMax) - v.length / 2;
  const end = (v: VehicleState) => (v.direction === 1 ? o.roadMax : -o.roadMin) + v.length / 2;
  function appearance(v: VehicleState) {
    v.opacity = v.active ? smooth(Math.min(v.x - o.roadMin, o.roadMax - v.x) / o.fadeDistance) : 0;
    v.wheelRotation = (v.direction * v.cumulativeDistance) / v.wheelRadius;
  }
  function integrate() {
    const stopping = red();
    const untilRed = o.driveSeconds - ((ticks * FIXED_DT) % (o.driveSeconds + o.stopSeconds));
    // Front-to-back processing means each follower sees the leader's new position.
    for (const direction of [1, -1] as const) {
      const lane = vehicles.filter((v) => v.direction === direction);
      for (const v of lane.filter((v) => !v.active)) {
        const start = entry(v);
        if (
          lane.every(
            (other) =>
              !other.active || position(other) - other.length / 2 >= start + v.length / 2 + o.gap,
          )
        ) {
          v.x = direction * start;
          v.active = true;
          v.speed = 0;
        }
      }
      const active = lane.filter((v) => v.active).sort((a, b) => position(b) - position(a));
      let leader: VehicleState | undefined;
      for (const v of active) {
        const q = position(v);
        let limit = Infinity;
        if (leader) limit = position(leader) - (leader.length + v.length) / 2 - o.gap;
        const stop = direction * o.crossingX - o.crossingWidth / 2 - o.stopMargin;
        const distanceToLine = stop - v.length / 2 - q;
        // Reserve a full braking interval before the scheduled red. The distance
        // term starts braking early for cars that cannot reach the line this green;
        // it decreases no faster than the clock, so braking cannot oscillate.
        // The braking envelope rests a sub-millimetre before the line. Let a
        // queued vehicle leave that numerical stand-off when green returns.
        const leavingStop =
          !stopping &&
          distanceToLine <= o.deceleration * FIXED_DT * FIXED_DT &&
          untilRed > 2 * FIXED_DT;
        const anticipateRed =
          !leavingStop &&
          untilRed <=
            Math.max(0, distanceToLine) / o.maxSpeed + o.maxSpeed / o.deceleration + 2 * FIXED_DT;
        // A front bumper beyond the line has committed and must clear the crossing.
        if ((stopping || anticipateRed) && q + v.length / 2 <= stop + 1e-9)
          limit = Math.min(limit, stop - v.length / 2);
        const remaining = Math.max(0, limit - q);
        const desired = Math.min(
          o.maxSpeed,
          Math.max(0, Math.sqrt(2 * o.deceleration * remaining) - o.deceleration * FIXED_DT),
        );
        const speed =
          v.speed +
          Math.max(
            -o.deceleration * FIXED_DT,
            Math.min(o.acceleration * FIXED_DT, desired - v.speed),
          );
        const travel = Math.min(remaining, Math.max(0, speed) * FIXED_DT);
        v.speed = travel / FIXED_DT;
        v.x += direction * travel;
        v.cumulativeDistance += travel;
        if (position(v) >= end(v)) {
          v.active = false;
          v.speed = 0;
        } else leader = v;
        appearance(v);
      }
    }
    ticks++;
  }
  for (const v of vehicles) appearance(v);
  return {
    /** Stable fleet objects for consumers to bind meshes to. Treat as read-only. */
    vehicles,
    get elapsed() {
      return ticks * FIXED_DT;
    },
    /** Wait for committed traffic to clear before allowing pedestrians onto asphalt. */
    get pedestriansMayCross() {
      return (
        red() &&
        vehicles.every(
          (v) => !v.active || Math.abs(v.x - o.crossingX) > (o.crossingWidth + v.length) / 2,
        )
      );
    },
    step(dt: number, moving = true) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and nonnegative");
      if (!moving) return;
      requestedTime += dt;
      const target = Math.floor((requestedTime + 1e-9) / FIXED_DT);
      while (ticks < target) integrate();
    },
    /** First call anchors the clock. Paused calls still update the anchor, preventing catch-up. */
    update(absoluteSeconds: number, moving = true) {
      if (!Number.isFinite(absoluteSeconds)) throw new RangeError("time must be finite");
      const dt = previousTime === undefined ? 0 : Math.max(0, absoluteSeconds - previousTime);
      previousTime = absoluteSeconds;
      this.step(dt, moving);
    },
  };
}
