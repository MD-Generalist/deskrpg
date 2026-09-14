/** Local receive time avoids trusting synchronized clocks or inventing sentAt. */
export type PeerMotionSample = { receivedAt: number; moving: boolean };

// This is a bounded client-side network assumption, not server authority. Beyond
// this budget a client cannot guarantee another independently driven position.
export const PEER_TRANSIT_BUDGET_MS = 100;
export const PEER_SEND_INTERVAL_MS = 66;
export const PEER_SPEED_TILES_PER_SECOND = 120 / 32;

export function peerMovementUncertainty(sample: PeerMotionSample, now: number, nextStepMs: number) {
  const step = Math.max(0, Math.min(100, nextStepMs));
  // A stopped peer may start immediately after its last report. Its startup
  // budget covers a send interval; do not accumulate age forever while idle.
  const horizon = sample.moving
    ? Math.max(0, Math.min(250, now - sample.receivedAt)) + PEER_TRANSIT_BUDGET_MS
    : Math.max(PEER_SEND_INTERVAL_MS, PEER_TRANSIT_BUDGET_MS);
  return (PEER_SPEED_TILES_PER_SECOND * (horizon + step)) / 1000;
}
