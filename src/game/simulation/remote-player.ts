import { LERP_FACTOR } from "./constants";

export interface RemotePlayerData {
  id: string;
  userId?: string;
  characterName: string;
  appearance: unknown;
  x: number;
  y: number;
  direction: string;
  animation: string;
}

/** 원격 플레이어. 서버 스냅샷 좌표(target)를 향해 프레임마다 보간한 표시 좌표(x, y)를 갖는다. */
export class RemotePlayer {
  readonly id: string;
  userId?: string;
  name: string;
  appearance: unknown;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  animation: string;

  constructor(data: RemotePlayerData) {
    this.id = data.id;
    this.userId = data.userId;
    this.name = data.characterName;
    this.appearance = data.appearance;
    this.x = this.targetX = data.x;
    this.y = this.targetY = data.y;
    this.direction = data.direction || "down";
    this.animation = data.animation || "idle";
  }

  updatePosition(x: number, y: number, direction: string, animation: string): void {
    this.targetX = x;
    this.targetY = y;
    this.direction = direction;
    this.animation = animation;
  }

  /** 가까우면 붙이고, 너무 멀면(200px 초과) 순간이동, 그 사이는 고정 비율 보간. */
  lerpUpdate(): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      this.x = this.targetX;
      this.y = this.targetY;
    } else if (Math.abs(dx) > 200 || Math.abs(dy) > 200) {
      this.x = this.targetX;
      this.y = this.targetY;
    } else {
      this.x += dx * LERP_FACTOR;
      this.y += dy * LERP_FACTOR;
    }
  }

  distanceTo(x: number, y: number): number {
    return Math.hypot(this.x - x, this.y - y);
  }
}
