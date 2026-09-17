/** 서버 와이어 계약의 방향 이름과 시뮬레이션 내부의 숫자 방향을 오간다. */
export const DIR_UP = 0;
export const DIR_LEFT = 1;
export const DIR_DOWN = 2;
export const DIR_RIGHT = 3;

export const DIR_NAME_MAP: Record<string, number> = {
  up: DIR_UP,
  left: DIR_LEFT,
  down: DIR_DOWN,
  right: DIR_RIGHT,
};
export const DIR_NUM_TO_NAME = ["up", "left", "down", "right"];

export function directionFromName(name: string | undefined): number {
  return DIR_NAME_MAP[name ?? "down"] ?? DIR_DOWN;
}

export function directionName(direction: number): string {
  return DIR_NUM_TO_NAME[direction] ?? "down";
}

/** 이동 벡터가 가리키는 방향. 가로 성분이 크면 좌우, 아니면 상하다. */
export function directionOfDelta(dx: number, dy: number, horizontalFirst = true): number {
  const horizontal = horizontalFirst ? Math.abs(dx) > Math.abs(dy) : Math.abs(dx) >= Math.abs(dy);
  if (horizontal) return dx > 0 ? DIR_RIGHT : DIR_LEFT;
  return dy > 0 ? DIR_DOWN : DIR_UP;
}
