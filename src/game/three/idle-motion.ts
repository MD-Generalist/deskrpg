import type { ActorPhase } from "./characters";
/** Smooth, staggered gestures with quiet intervals; deterministic across frame rates. */
export function idleMotion(t: number, seed: number, walking: boolean, phase: ActorPhase) {
  const clock = t + seed * 2.731;
  const pulse = (period: number, offset: number, duration: number) => {
    const local = (((clock + offset) % period) + period) % period;
    return local < duration ? Math.sin((Math.PI * local) / duration) ** 2 : 0;
  };
  if (walking) return { yaw: 0, nod: 0, hand: 0, sway: 0 };
  const speaking = phase === "streaming";
  return {
    yaw:
      phase === "thinking"
        ? Math.sin(clock * 0.6) * 0.09
        : 0.38 * pulse(13, 0, 3.4) - 0.32 * pulse(13, 6.4, 3.2),
    nod: speaking ? Math.sin(clock * 3) * 0.055 : pulse(17, 7, 2) * 0.085,
    hand: phase === "idle" || phase === "done" ? pulse(19, 4, 3.2) : 0,
    sway: Math.sin(clock * 0.75) * 0.013,
  };
}
