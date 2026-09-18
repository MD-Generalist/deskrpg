/** 서버 픽셀 좌표계: 타일 하나가 32px. 렌더러의 `PIXELS_PER_TILE` 과 같은 값이다. */
export const TILE_SIZE = 32;
export const MAP_COLS = 40;
export const MAP_ROWS = 30;
export const PLAYER_SPEED = 120;
export const MOVE_SEND_INTERVAL = 66;
export const LERP_FACTOR = 0.2;
export const NPC_INTERACT_RADIUS = 64;

/** 옛 타일셋 인덱스 가운데 시뮬레이션이 아직 뜻을 읽는 것들. */
export const TILE_EMPTY = 0;
export const TILE_FLOOR = 1;
export const TILE_WALL = 2;
/** 걸을 수 없는 벽 레이어 타일(레거시 맵). 오브젝트 충돌은 점유 타일 집합이 맡는다. */
export const COLLISION_TILES = new Set([TILE_WALL]);
