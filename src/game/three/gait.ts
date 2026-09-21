import { RUN_SPEED_THRESHOLD } from "../../lib/npc-motion-config";

/** 걸음새. `cadence` 는 걷기 동작을 몇 배 빠르게 돌릴지다(달릴 때만 1 보다 크다). */
export type ActorGait = { running: boolean; cadence: number };

export const WALKING_GAIT: ActorGait = { running: false, cadence: 1 };

/**
 * 걷기 동작이 발을 미끄러뜨리지 않는 이동 속도(칸/초). 걷기 클립과 절차적 걸음은 NPC 의 옛 기본
 * 속도(150px/s)에 맞춰져 있다.
 */
export const WALK_CLIP_TILES_PER_SECOND = 150 / 32;
const RUN_ENTER = RUN_SPEED_THRESHOLD / 32;
// 들어가는 문턱보다 낮은 곳에서 나온다 — 속도가 문턱 근처에서 떨리면 뛰었다 걸었다 깜빡이지 않게.
const RUN_EXIT = RUN_ENTER * 0.8;
const SMOOTHING_SECONDS = 0.15;
// 한 프레임에 이만큼 넘게 움직였으면 걸은 것이 아니라 순간이동(재배치·동기화)이다.
const TELEPORT_TILES = 2;

/**
 * 화면에 보이는 이동 속도로 뛰는지 가른다. **이동 종류가 아니라 관측한 속도**로 가르므로 소켓
 * 계약을 바꾸지 않고도 모든 사람 화면에서 같게 보인다 — NPC 를 구동하는 브라우저든 방송된 위치를
 * 따라가는 브라우저든 같은 속도를 본다. 그리고 소유자가 호출을 평소 속도로 낮추면 저절로 걷는
 * 모양으로 돌아간다(느린데 뛰는 모양이 나오지 않는다).
 */
export function createGaitTracker() {
  let speed = 0;
  let running = false;
  return {
    update(dxTiles: number, dzTiles: number, dtSeconds: number, walking: boolean): ActorGait {
      const moved = Math.hypot(dxTiles, dzTiles);
      if (dtSeconds > 0 && moved < TELEPORT_TILES) {
        const sample = walking ? moved / dtSeconds : 0;
        const alpha = 1 - Math.exp(-dtSeconds / SMOOTHING_SECONDS);
        speed += (sample - speed) * alpha;
      }
      running = walking && (running ? speed >= RUN_EXIT : speed >= RUN_ENTER);
      if (!running) return WALKING_GAIT;
      const cadence = Math.min(2.6, Math.max(1.2, speed / WALK_CLIP_TILES_PER_SECOND));
      return { running: true, cadence };
    },
    get speed() {
      return speed;
    },
  };
}
