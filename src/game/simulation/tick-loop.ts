/**
 * requestAnimationFrame 기반 틱 루프. 탭이 가려진 동안은 타이머로 이어 간다.
 *
 * 가려진 탭에서 브라우저는 rAF 를 **멈춘다**(스로틀이 아니다). NPC 걸음은 이 루프가 구동하므로
 * 예전에는 탭을 가리면 직원이 걷지 않아 호출·회의 집결이 "이동 중" 에서 굳었다. 가려진 동안은
 * `setInterval` 로 틱을 잇는다 — 브라우저가 가려진 탭의 타이머를 1초 간격으로 줄여도 걸음은
 * 진행되고 도착 통지는 나간다. 서버도 멈춘 걸음을 기한 뒤 정산하지만(`STALLED_MOTION_MS`),
 * 여기서 걸어 두면 탭이 돌아왔을 때 순간이동이 줄어든다.
 *
 * dt 는 실제 경과 시간을 쓰되 한 스텝의 상한을 둔다: 한 번에 수십 초가 들어오면 경로 추종·
 * 대기 타이머가 한꺼번에 튀기 때문이다. 가려진 틱은 긴 경과를 상한 크기 스텝 여러 개로 나눈다 —
 * 그러지 않으면 1초 간격 타이머에서 200ms 만 반영돼 걸음이 원래 속도의 1/5 이 된다.
 */
export const MAX_FRAME_DELTA_MS = 200;
/** 가려진 동안 틱 간격(브라우저가 1초로 늘릴 수 있다). */
export const HIDDEN_TICK_MS = 250;
/** 가려진 틱 한 번이 따라잡는 최대 경과. 탭이 오래 잠들었다 깨어나도 이만큼만 몰아서 걷는다. */
export const HIDDEN_MAX_CATCH_UP_MS = 2_000;

/** 첫 프레임(이전 시각 없음)은 0, 그 뒤로는 실제 경과를 상한으로 자른 값. 음수는 0 이다. */
export function clampFrameDelta(
  now: number,
  previous: number | null,
  max: number = MAX_FRAME_DELTA_MS,
): number {
  if (previous === null) return 0;
  return Math.max(0, Math.min(now - previous, max));
}

/** 가려진 틱 한 번의 스텝들. 경과(최대 `catchUp`)를 `max` 이하 조각으로 나눈다. */
export function hiddenStepDeltas(
  now: number,
  previous: number | null,
  max: number = MAX_FRAME_DELTA_MS,
  catchUp: number = HIDDEN_MAX_CATCH_UP_MS,
): number[] {
  if (previous === null) return [];
  let remaining = Math.max(0, Math.min(now - previous, catchUp));
  const steps: number[] = [];
  while (remaining > 0) {
    const step = Math.min(remaining, max);
    steps.push(step);
    remaining -= step;
  }
  return steps;
}

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export class TickLoop {
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
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
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.onVisibility);
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.onVisibility);
    cancelAnimationFrame(this.frame);
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    this.previous = null;
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (isHidden()) this.interval = setInterval(this.hiddenTick, HIDDEN_TICK_MS);
    else this.frame = requestAnimationFrame(this.tick);
  }

  private onVisibility = () => {
    if (!this.running) return;
    // rAF 와 performance.now 는 같은 시계다. 전환 시 이전 시각을 버리면 첫 틱이 0 이 되어
    // 두 시계 사이의 공백이 한꺼번에 들어오지 않는다.
    this.previous = null;
    this.schedule();
  };

  private hiddenTick = () => {
    if (!this.running) return;
    const now = performance.now();
    let at = this.previous ?? now;
    for (const delta of hiddenStepDeltas(now, this.previous, this.maxDelta)) {
      at += delta;
      this.step(at, delta);
    }
    this.previous = now;
  };

  private tick = (now: number) => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    const delta = clampFrameDelta(now, this.previous, this.maxDelta);
    this.previous = now;
    this.step(now, delta);
  };
}
