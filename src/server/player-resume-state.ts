export type PlayerDestination = { targetX: number; targetY: number; seatId?: string };
export type PlayerIdentity = { userId: string; characterId: string; mapId: string };
export type PlayerResumeState = {
  x: number;
  y: number;
  direction: string;
  animation: string;
  motion: PlayerDestination | null;
};
const finiteCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
export function readPlayerDestination(value: unknown): PlayerDestination | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!finiteCoordinate(v.targetX) || !finiteCoordinate(v.targetY)) return null;
  return {
    targetX: v.targetX,
    targetY: v.targetY,
    ...(typeof v.seatId === "string" && v.seatId.length <= 256 ? { seatId: v.seatId } : {}),
  };
}
/** Process-local, authenticated identity state. Socket lifetime is not player lifetime. */
export class PlayerResumeStore {
  private readonly entries = new Map<string, { at: number; state: PlayerResumeState }>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }
  private key(identity: PlayerIdentity) {
    return JSON.stringify([identity.userId, identity.characterId, identity.mapId]);
  }
  save(
    value: PlayerIdentity & {
      x: number;
      y: number;
      direction: string;
      animation: string;
      motion?: unknown;
    },
  ) {
    if (!finiteCoordinate(value.x) || !finiteCoordinate(value.y)) return;
    const key = this.key(value);
    this.entries.delete(key);
    this.entries.set(key, {
      at: this.now(),
      state: {
        x: value.x,
        y: value.y,
        direction: ["up", "down", "left", "right"].includes(value.direction)
          ? value.direction
          : "down",
        animation: value.animation === "walk" ? "walk" : "idle",
        motion: readPlayerDestination(value.motion),
      },
    });
    while (this.entries.size > this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
  }
  clearChannel(channelId: string) {
    for (const key of this.entries.keys())
      if (JSON.parse(key)[2] === channelId) this.entries.delete(key);
  }
  get(identity: PlayerIdentity): PlayerResumeState | undefined {
    const key = this.key(identity),
      entry = this.entries.get(key);
    if (!entry) return;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return;
    }
    return { ...entry.state, motion: entry.state.motion ? { ...entry.state.motion } : null };
  }
}
