/** Serializable protocol schema shared with the browser; no rendering imports. */
export type MotionContinuation = {
  ambientSchedule: {
    phase: "rest" | "roam" | "home";
    elapsed: number;
    duration: number;
    pause: number;
    seatTarget?: { x: number; y: number };
    seatRest?: number;
    visitedSeat?: boolean;
  };
  ambientSeat?: { x: number; y: number };
  ambientTimer?: number;
  path?: { x: number; y: number }[];
};

/** Copy only bounded, serializable motion data; client input never carries code or clocks. */
export function parseMotionContinuation(
  raw: unknown,
  bounds?: { width: number; height: number },
): { ok: true; value: MotionContinuation | null | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: raw };
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const timer = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
  const point = (value: unknown): value is { x: number; y: number } =>
    object(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.x < (bounds ? bounds.width / 32 : 100_000) &&
    value.y < (bounds ? bounds.height / 32 : 100_000);
  if (!object(raw) || !object(raw.ambientSchedule)) return { ok: false };
  const schedule = raw.ambientSchedule;
  if (
    typeof schedule.phase !== "string" ||
    !["rest", "roam", "home"].includes(schedule.phase) ||
    !timer(schedule.elapsed) ||
    !timer(schedule.duration) ||
    !timer(schedule.pause) ||
    (schedule.seatRest !== undefined && !timer(schedule.seatRest)) ||
    (schedule.visitedSeat !== undefined && typeof schedule.visitedSeat !== "boolean") ||
    (schedule.seatTarget !== undefined && !point(schedule.seatTarget)) ||
    (raw.ambientSeat !== undefined && !point(raw.ambientSeat)) ||
    (raw.ambientTimer !== undefined && !timer(raw.ambientTimer)) ||
    (raw.path !== undefined &&
      (!Array.isArray(raw.path) || raw.path.length > 256 || !raw.path.every(point)))
  )
    return { ok: false };
  return {
    ok: true,
    value: {
      ambientSchedule: {
        phase: schedule.phase as MotionContinuation["ambientSchedule"]["phase"],
        elapsed: schedule.elapsed,
        duration: schedule.duration,
        pause: schedule.pause,
        ...(schedule.seatRest !== undefined ? { seatRest: schedule.seatRest as number } : {}),
        ...(schedule.visitedSeat !== undefined
          ? { visitedSeat: schedule.visitedSeat as boolean }
          : {}),
        ...(point(schedule.seatTarget)
          ? { seatTarget: { x: schedule.seatTarget.x, y: schedule.seatTarget.y } }
          : {}),
      },
      ...(point(raw.ambientSeat)
        ? { ambientSeat: { x: raw.ambientSeat.x, y: raw.ambientSeat.y } }
        : {}),
      ...(raw.ambientTimer !== undefined ? { ambientTimer: raw.ambientTimer as number } : {}),
      ...(Array.isArray(raw.path) ? { path: raw.path.map((p) => ({ x: p.x, y: p.y })) } : {}),
    },
  };
}
