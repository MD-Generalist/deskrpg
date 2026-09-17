/**
 * requestAnimationFrame 기반 틱 루프.
 *
 * 가려진 탭에서 브라우저가 rAF 를 스로틀하면 시뮬레이션도 그만큼 느려진다 — 옛 게임 루프와
 * 같다. dt 는 실제 경과 시간을 쓰되 상한을 둔다: 탭이 돌아온 첫 프레임에 수십 초가 한 번에
 * 들어오면 경로 추종·대기 타이머가 한꺼번에 튀기 때문이다.
 */
export const MAX_FRAME_DELTA_MS = 200;

/** 첫 프레임(이전 시각 없음)은 0, 그 뒤로는 실제 경과를 상한으로 자른 값. 음수는 0 이다. */
export function clampFrameDelta(
  now: number,
  previous: number | null,
  max: number = MAX_FRAME_DELTA_MS,
): number {
  if (previous === null) return 0;
  return Math.max(0, Math.min(now - previous, max));
}

export class TickLoop {
  private frame = 0;
  private previous: number | null = null;
  private running = false;

  constructor(
    private readonly step: (now: number, delta: number) => void,
    private readonly maxDelta: number = MAX_FRAME_DELTA_MS,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previous = null;
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.previous = null;
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    const delta = clampFrameDelta(now, this.previous, this.maxDelta);
    this.previous = now;
    this.step(now, delta);
  };
}
