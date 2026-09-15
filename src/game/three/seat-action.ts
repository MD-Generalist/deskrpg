export type SeatAction = {
  /** Navigation anchor used by the existing click-to-walk flow. */
  x: number;
  z: number;
  /** Visual cushion position used to anchor the action popup. */
  seatX: number;
  seatZ: number;
};

const PIXELS_PER_TILE = 32;

export function seatReservationId(x: number, z: number) {
  return `${x * PIXELS_PER_TILE}:${z * PIXELS_PER_TILE}`;
}

/** Prefer a newly selected seat path over the seat the player is currently leaving. */
export function resolveSeatIntent(
  pathGoal: { x: number; y: number; seat: boolean } | null | undefined,
  currentSeatId: string | null,
) {
  return pathGoal?.seat ? seatReservationId(pathGoal.x + 0.5, pathGoal.y + 0.5) : currentSeatId;
}

/** Keep selection feedback only while the matching trip is still underway. */
export function seatSelectionHighlighted(
  selectedId: string,
  activeIntentId: string | null,
  playerDistance: number,
  walking: boolean,
) {
  return selectedId === activeIntentId && (walking || playerDistance >= 0.45);
}

type SeatPoint = {
  x: number;
  z: number;
  anchorX?: number;
  anchorZ?: number;
};

/** Select the cushion nearest the ray hit, while keeping occupied seats undiscoverable. */
export function resolveSeatAction<T extends SeatPoint>(
  seats: T[],
  hit: { x: number; z: number },
  available: (seat: T) => boolean,
): SeatAction | null {
  const seat = seats
    .filter(available)
    .sort((a, b) => Math.hypot(a.x - hit.x, a.z - hit.z) - Math.hypot(b.x - hit.x, b.z - hit.z))[0];
  if (!seat) return null;
  return {
    x: seat.anchorX ?? seat.x,
    z: seat.anchorZ ?? seat.z,
    seatX: seat.x,
    seatZ: seat.z,
  };
}
