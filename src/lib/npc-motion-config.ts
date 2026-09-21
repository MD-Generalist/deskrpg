/**
 * NPC 걸음 속도 — **채널 전체가 공유**한다(소유자가 채널 설정에서 바꾼다).
 *
 * 보는 사람마다 두지 않는 이유: NPC 이동은 서버가 아니라 채널에 접속한 브라우저 하나가 구동해
 * 나머지에게 방송한다. 사람마다 다르면 누가 구동하느냐에 따라 모두가 보는 속도가 바뀐다.
 *
 * 단위는 px/s(한 칸 = 32px). 네 종류는 코드의 이동 경로와 하나씩 맞물린다:
 * - `summon`        호출(`npc:come-to-player` → `moveTo`)
 * - `meetingSummon` 회의 호출(`spatialTarget` 경로). 전에는 산책 속도(55)로 걸었다.
 * - `walk`          일반 이동(복귀·대화하러 다가가기)
 * - `stroll`        주변 산책
 */
export type NpcMotionConfig = {
  walk: number;
  stroll: number;
  summon: number;
  meetingSummon: number;
};

export const NPC_MOTION_KINDS: readonly (keyof NpcMotionConfig)[] = [
  "summon",
  "meetingSummon",
  "walk",
  "stroll",
];

/** 단테 결정(2026-09-21): 호출·회의 호출은 평소 걸음의 2배 — 뛰어온다. */
export const DEFAULT_NPC_MOTION: NpcMotionConfig = {
  walk: 150,
  stroll: 55,
  summon: 300,
  meetingSummon: 300,
};

/**
 * 조정 범위. 아래는 한 칸에 1.6초(너무 느리면 멈춘 것처럼 보인다), 위는 한 칸에 0.067초 — 경로
 * 재계산·충돌 판정이 프레임 사이에서 칸을 건너뛰지 않는 한계 근처다.
 */
export const NPC_SPEED_RANGE = { min: 20, max: 480, step: 5 } as const;

/**
 * 이 속도 이상이면 뛰는 모양으로 그린다(px/s). 평소 걸음 기본값(150)과 호출 기본값(300)의
 * 가운데쯤이다. 이동 종류가 아니라 **실제 속도**로 가르므로, 소유자가 호출을 평소 속도로
 * 낮추면 걷는 모양으로 돌아간다 — 느린데 뛰는 모양이 나오지 않는다.
 */
export const RUN_SPEED_THRESHOLD = 225;

function clampSpeed(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(NPC_SPEED_RANGE.max, Math.max(NPC_SPEED_RANGE.min, n));
  return Math.round(clamped / NPC_SPEED_RANGE.step) * NPC_SPEED_RANGE.step;
}

/**
 * 저장된 값(DB·소켓·요청 본문)을 믿지 않고 접는다. 컬럼이 비어 있으면(`null`) 기본값이고, 틀린
 * 항목만 기본값으로 떨어진다. 알 수 없는 키는 버린다.
 */
export function normalizeNpcMotionConfig(value: unknown): NpcMotionConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_NPC_MOTION;
  return {
    walk: clampSpeed(raw.walk, d.walk),
    stroll: clampSpeed(raw.stroll, d.stroll),
    summon: clampSpeed(raw.summon, d.summon),
    meetingSummon: clampSpeed(raw.meetingSummon, d.meetingSummon),
  };
}

/** 칸/초로 — 화면에 보여 줄 때 px/s 보다 읽기 쉽다. */
export function tilesPerSecond(pxPerSecond: number): number {
  return Math.round((pxPerSecond / 32) * 10) / 10;
}
