import { clearSegment, type NavigationPoint, type Walkable } from "../navigation";
import { createAmbientSchedule, type AmbientSchedule } from "../npc-ambient";
import type { AmbientExitPolicy } from "../ambient-zones";
import type { RemoteNpcPresentation } from "../remote-npc-presentation";
import { TILE_SIZE } from "./constants";
import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, directionFromName } from "./directions";
import { DEFAULT_NPC_MOTION } from "../../lib/npc-motion-config";

export interface NpcData {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  direction: string;
  appearance?: unknown;
}

export type NpcPathfinder = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  walkable: Walkable,
) => NavigationPoint[] | null;

export type NpcMoveState = "idle" | "moving-to-player" | "waiting" | "returning" | "strolling";

/**
 * README 캡처는 회의 장면을 9초 안에 담아야 하는데, 평소 걸음으로는 모이는 데만 16초가 걸린다
 * (실측 2026-09-20). 캡처 런타임에서만 걸음을 빠르게 한다 — 서비스 값은 그대로다.
 */
export const CAPTURE_WALK_MULTIPLIER = 3;
export function captureWalkSpeed(speed: number): number {
  return process.env.NEXT_PUBLIC_README_CAPTURE === "1" ? speed * CAPTURE_WALK_MULTIPLIER : speed;
}

/**
 * NPC 한 명의 이동 상태 기계. 화면 요소는 없다 — `pixelX/pixelY` 가 충돌·권위 좌표이고,
 * `viewX/viewY` 는 렌더러에 내보내는 표시 좌표다(원격 구동 NPC 는 보간 표시가 따로 따라온다).
 */
export class NpcController {
  appearance: unknown;
  id: string;
  name: string;
  pixelX: number;
  pixelY: number;
  viewX: number;
  viewY: number;
  direction: number;

  // 이동 상태(런타임 전용, 저장하지 않는다)
  homeCol: number;
  homeRow: number;
  homeDirection: number;
  currentPath: NavigationPoint[] | null = null;
  pathIndex = 0;
  private trafficBlockedMs = 0;
  actuallyWalking = false;
  moveState: NpcMoveState = "idle";
  destinationTag: string | null = null;
  destinationTarget: NavigationPoint | null = null;
  purposeAccessOrigin: NavigationPoint | null = null;
  ambientPaused = false;
  ambientTimer = 0;
  ambientSchedule: AmbientSchedule = createAmbientSchedule();
  ambientSeat: { x: number; y: number } | null = null;
  ambientExitPolicy: AmbientExitPolicy | null = null;
  remoteWalkingUntil = 0;
  remotePresentation: RemoteNpcPresentation | null = null;
  motionLocallyDriven?: boolean;
  /** 일반 이동(복귀·대화 접근) 속도, px/s. 채널 걸음 설정이 덮어쓴다(`npc-motion-config`). */
  moveSpeed = DEFAULT_NPC_MOTION.walk;
  /** 산책 속도, px/s. */
  strollSpeed = DEFAULT_NPC_MOTION.stroll;
  /**
   * 지금 걷는 경로의 속도. 호출·회의 호출처럼 경로마다 다른 속도를 쓰는 이동이 정한다.
   * `null` 이면 상태에 맞는 기본값(산책이면 `strollSpeed`, 그 밖엔 `moveSpeed`)이다.
   */
  pathSpeed: number | null = null;
  pendingMessage: string | null = null;
  arrivalBubbleText: string | null = null;
  waitDurationMs = 10000;
  /** 어느 방에서 불렀나 — null 이면 직접 부른 것. "r1" 같은 roomId 면 방에서 불렀으므로 그 방이 보이는 동안 자리로 돌아가지 않는다. */
  calledForRoom: string | null = null;
  private pathRecalcTimer = 0; // ms 누적
  private stuckFrames = 0;
  private lastDist = Infinity;
  waitTimer = 0; // "waiting" 상태로 누적된 ms

  constructor(data: NpcData) {
    this.id = data.id;
    this.appearance = data.appearance;
    this.name = data.name;
    this.pixelX = data.positionX * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = data.positionY * TILE_SIZE + TILE_SIZE / 2;
    this.viewX = this.pixelX;
    this.viewY = this.pixelY;
    this.direction = directionFromName(data.direction);
    this.homeCol = data.positionX;
    this.homeRow = data.positionY;
    this.homeDirection = this.direction;
  }

  /** 권위 좌표를 표시 좌표로 옮긴다. 로컬 구동 이동은 매 프레임 이것을 부른다. */
  syncView(): void {
    this.viewX = this.pixelX;
    this.viewY = this.pixelY;
  }

  /** 권위 좌표와 표시 좌표를 함께 옮긴다(스냅). */
  setPosition(x: number, y: number): void {
    this.pixelX = x;
    this.pixelY = y;
    this.syncView();
  }

  distanceTo(x: number, y: number): number {
    return Math.hypot(this.pixelX - x, this.pixelY - y);
  }

  updateName(name: string): void {
    this.name = name;
  }

  updateDirection(direction: string): void {
    this.homeDirection = directionFromName(direction);
    this.direction = this.homeDirection;
    this.stopWalking();
  }

  updateAppearance(appearance: unknown): void {
    if (!appearance) return;
    this.appearance = appearance;
  }

  updateFromData(data: { name?: string; direction?: string; appearance?: unknown }): void {
    if (typeof data.name === "string" && data.name.trim()) this.updateName(data.name);
    if (typeof data.direction === "string") this.updateDirection(data.direction);
    if (data.appearance !== undefined) this.updateAppearance(data.appearance);
  }

  moveTo(
    targetCol: number,
    targetRow: number,
    findPathFn: NpcPathfinder,
    isWalkableFn: Walkable,
    options?: {
      message?: string;
      bubbleText?: string;
      waitDurationMs?: number;
      destinationTag?: string;
      /** 이 이동의 속도(px/s). 호출은 뛰어온다 — 평소 걸음과 다르다. */
      speed?: number;
    },
  ): boolean {
    const startCol = Math.floor(this.pixelX / TILE_SIZE);
    const startRow = Math.floor(this.pixelY / TILE_SIZE);

    // 플레이어 타일까지 바로 경로를 잡는다 — 도착은 NPC_INTERACT_RADIUS 로 판정하므로
    // 실제로 겹치기 전에 멈춘다.
    const path = findPathFn(startCol, startRow, targetCol, targetRow, isWalkableFn);
    if (!path || path.length === 0) return false;

    this.currentPath = path;
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.pathRecalcTimer = 0;
    this.pendingMessage = options?.message || null;
    this.arrivalBubbleText = options?.bubbleText || null;
    this.waitDurationMs = options?.waitDurationMs ?? 10000;
    this.pathSpeed = options?.speed ?? null;
    this.destinationTag = options?.destinationTag ?? null;
    this.destinationTarget = this.destinationTag ? { x: targetCol, y: targetRow } : null;
    this.purposeAccessOrigin = this.destinationTag ? { x: startCol, y: startRow } : null;
    this.moveState = "moving-to-player";
    return true;
  }

  /** 지금 걷는 속도(px/s). README 캡처 런타임에서는 배수가 붙는다. */
  currentSpeed(): number {
    const base =
      this.pathSpeed ?? (this.moveState === "strolling" ? this.strollSpeed : this.moveSpeed);
    return captureWalkSpeed(base);
  }

  /** `speed` 를 주면 산책 속도 대신 그 속도로 걷는다 — 회의 집결이 이 경로를 쓴다. */
  startStroll(path: NavigationPoint[], speed?: number): void {
    this.pathSpeed = speed ?? null;
    this.destinationTag = null;
    this.destinationTarget = null;
    this.purposeAccessOrigin = null;
    this.currentPath = path;
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.moveState = "strolling";
  }

  stopStroll(): void {
    if (this.moveState !== "strolling") return;
    this.currentPath = null;
    this.moveState = "idle";
    this.stopWalking();
  }

  cancelMovement(): void {
    this.currentPath = null;
    this.moveState = "idle";
    this.ambientPaused = false;
    this.remoteWalkingUntil = 0;
    this.pendingMessage = null;
    this.destinationTag = null;
    this.destinationTarget = null;
    this.purposeAccessOrigin = null;
    this.stopWalking();
  }

  returnToHome(findPathFn: NpcPathfinder, isWalkableFn: Walkable): boolean {
    this.calledForRoom = null;
    this.destinationTag = null;
    this.destinationTarget = null;
    this.purposeAccessOrigin = null;
    this.ambientTimer = 0;
    const startCol = Math.floor(this.pixelX / TILE_SIZE);
    const startRow = Math.floor(this.pixelY / TILE_SIZE);

    if (
      Math.hypot(
        this.pixelX - (this.homeCol + 0.5) * TILE_SIZE,
        this.pixelY - (this.homeRow + 0.5) * TILE_SIZE,
      ) < 2
    ) {
      this.moveState = "idle";
      this.snapToHome();
      return true;
    }

    // 자리가 막혀 있거나 끊겨 있어도 복귀는 대기 상태로 남는다 — 벽을 뚫고 순간이동하지 않는다.
    this.currentPath = findPathFn(startCol, startRow, this.homeCol, this.homeRow, isWalkableFn);
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.pathRecalcTimer = 0;
    this.pendingMessage = null;
    this.arrivalBubbleText = null;
    this.waitDurationMs = 10000;
    this.pathSpeed = null;
    this.moveState = "returning";
    return true;
  }

  private snapToHome(): void {
    this.pixelX = this.homeCol * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = this.homeRow * TILE_SIZE + TILE_SIZE / 2;
    this.direction = this.homeDirection;
    this.syncView();
    this.stopWalking();
  }

  pauseForSmalltalk(other: NpcController): void {
    // 경로와 목표 지점을 유지해 대화가 끝나면 같은 산책을 잇는다.
    if (this.moveState === "strolling") {
      const dx = other.pixelX - this.pixelX,
        dy = other.pixelY - this.pixelY;
      this.direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR_RIGHT : DIR_LEFT) : dy > 0 ? DIR_DOWN : DIR_UP;
    }
    this.stopWalking();
  }

  private stopWalking(): void {
    this.actuallyWalking = false;
  }

  updateMovement(
    delta: number,
    playerX: number,
    playerY: number,
    findPathFn: NpcPathfinder,
    isWalkableFn: Walkable,
    trafficStep?: (
      position: NavigationPoint,
      goal: NavigationPoint,
      amount: number,
    ) => NavigationPoint,
  ): "arrived" | "returning-done" | "moving" | "idle" {
    this.actuallyWalking = false;
    if (this.moveState === "idle" || this.moveState === "waiting") return "idle";
    if (!this.currentPath) {
      this.pathRecalcTimer += Math.min(delta, 100);
      if (this.pathRecalcTimer < 1000) return "idle";
      this.pathRecalcTimer = 0;
      const targetX =
        this.moveState === "returning"
          ? this.homeCol
          : (this.destinationTarget?.x ?? Math.floor(playerX / TILE_SIZE));
      const targetY =
        this.moveState === "returning"
          ? this.homeRow
          : (this.destinationTarget?.y ?? Math.floor(playerY / TILE_SIZE));
      const path = findPathFn(
        Math.floor(this.pixelX / TILE_SIZE),
        Math.floor(this.pixelY / TILE_SIZE),
        targetX,
        targetY,
        isWalkableFn,
      );
      if (!path) return "idle";
      this.currentPath = path;
      this.pathIndex = 0;
      this.stuckFrames = 0;
      this.lastDist = Infinity;
    }

    // --- 경로 재계산(3초마다, 플레이어에게 가는 중일 때만) ---
    if (this.moveState === "moving-to-player" && !this.destinationTag) {
      this.pathRecalcTimer += delta;
      if (this.pathRecalcTimer >= 3000) {
        this.pathRecalcTimer = 0;
        const distToPlayer = this.distanceTo(playerX, playerY);
        if (distToPlayer > TILE_SIZE + 4) {
          const playerCol = Math.floor(playerX / TILE_SIZE);
          const playerRow = Math.floor(playerY / TILE_SIZE);
          const startCol = Math.floor(this.pixelX / TILE_SIZE);
          const startRow = Math.floor(this.pixelY / TILE_SIZE);
          const newPath = findPathFn(startCol, startRow, playerCol, playerRow, isWalkableFn);
          if (newPath && newPath.length > 0) {
            this.currentPath = newPath;
            this.pathIndex = 0;
            this.stuckFrames = 0;
            this.lastDist = Infinity;
          }
        }
      }

      // --- 도착 판정 — 상호작용 거리(한 타일) 안 ---
      const distToPlayer = this.distanceTo(playerX, playerY);
      if (distToPlayer < TILE_SIZE + 4) {
        // ~36px — 플레이어 바로 옆
        this.currentPath = null;
        this.moveState = "waiting";
        const adx = playerX - this.pixelX;
        const ady = playerY - this.pixelY;
        if (Math.abs(adx) > Math.abs(ady)) {
          this.direction = adx > 0 ? DIR_RIGHT : DIR_LEFT;
        } else {
          this.direction = ady > 0 ? DIR_DOWN : DIR_UP;
        }
        this.stopWalking();
        this.waitTimer = 0;
        return "arrived";
      }
    }

    // --- 경로 소진 확인 ---
    if (this.pathIndex >= this.currentPath.length) {
      if (this.moveState === "strolling") {
        this.stopStroll();
        return "idle";
      }
      if (this.moveState === "returning") {
        // 경로가 끝났다 — 거리와 무관하게 자리에 붙인다
        this.snapToHome();
        this.currentPath = null;
        this.moveState = "idle";
        return "returning-done";
      }
      if (this.destinationTag) return this.finishDestinationMove();
      // 플레이어에게 가는 중인데 닿지 못하고 경로가 끝났다 — 재계산을 기다린다
      this.currentPath = null;
      return "moving";
    }

    // --- 경로 추종(플레이어와 같은 방식) ---
    const target = this.currentPath[this.pathIndex];
    if (this.moveState === "strolling" && !isWalkableFn(target.x, target.y)) {
      this.stopStroll();
      return "idle";
    }
    const targetPx = target.x * TILE_SIZE + TILE_SIZE / 2;
    const targetPy = target.y * TILE_SIZE + TILE_SIZE / 2;

    const dx = targetPx - this.pixelX;
    const dy = targetPy - this.pixelY;
    const dist = Math.hypot(dx, dy);

    // 갇힘 감지(플레이어와 같다)
    if (dist < this.lastDist - 0.5) {
      this.stuckFrames = 0;
      this.lastDist = dist;
    } else {
      this.stuckFrames++;
    }

    const reached = dist < 2;
    const stuck = !trafficStep && this.stuckFrames > 30;

    if (stuck && !reached) {
      if (this.moveState === "strolling") {
        this.stopStroll();
        return "idle";
      }
      this.currentPath = null;
      this.pathRecalcTimer = 0;
      this.stopWalking();
      return "moving";
    }
    if (reached) {
      // 다음 경유지로(스냅 없이 — 플레이어와 같다)
      this.pathIndex++;
      this.stuckFrames = 0;
      this.lastDist = Infinity;

      if (this.pathIndex >= this.currentPath.length) {
        if (this.moveState === "strolling") {
          this.stopStroll();
          return "idle";
        }
        if (this.moveState === "returning") {
          this.snapToHome();
          this.currentPath = null;
          this.moveState = "idle";
          this.stopWalking();
          return "returning-done";
        }
        if (this.destinationTag) return this.finishDestinationMove();
        // 플레이어에게 가는 경로가 끝났다 — 다음 재계산 주기를 기다린다
        this.currentPath = null;
        this.stopWalking();
        return "moving";
      }
    }

    // 항상 현재 경유지를 향해 움직인다(속도 기반)
    const curTarget = this.currentPath[this.pathIndex];
    const curPx = curTarget.x * TILE_SIZE + TILE_SIZE / 2;
    const curPy = curTarget.y * TILE_SIZE + TILE_SIZE / 2;
    const cdx = curPx - this.pixelX;
    const cdy = curPy - this.pixelY;

    const moveAmount = Math.min(
      Math.hypot(cdx, cdy),
      this.currentSpeed() * (Math.min(delta, 100) / 1000),
    );
    const angle = Math.atan2(cdy, cdx);
    const planned = trafficStep?.(
      { x: this.pixelX / TILE_SIZE - 0.5, y: this.pixelY / TILE_SIZE - 0.5 },
      curTarget,
      moveAmount / TILE_SIZE,
    );
    const nextX = planned
      ? (planned.x + 0.5) * TILE_SIZE
      : this.pixelX + Math.cos(angle) * moveAmount;
    const nextY = planned
      ? (planned.y + 0.5) * TILE_SIZE
      : this.pixelY + Math.sin(angle) * moveAmount;
    if (
      !clearSegment(
        { x: this.pixelX / TILE_SIZE - 0.5, y: this.pixelY / TILE_SIZE - 0.5 },
        { x: nextX / TILE_SIZE - 0.5, y: nextY / TILE_SIZE - 0.5 },
        isWalkableFn,
      )
    ) {
      if (this.moveState === "strolling") {
        this.stopStroll();
        return "idle";
      }
      this.currentPath = null;
      this.pathRecalcTimer = 0;
      this.stopWalking();
      return "moving";
    }
    if (Math.hypot(nextX - this.pixelX, nextY - this.pixelY) < 1e-6) {
      this.trafficBlockedMs += Math.min(delta, 100);
      // 멈춰 선 액터가 중간 경유지를 영영 차지할 수 있다. 교통 조정은 그 경유지에
      // 닿을 수 없으므로 목적지까지 전체 경로를 다시 잡아 우회한다.
      if (this.trafficBlockedMs >= 1500) {
        // 우회로가 없어도 산책·좌석 목적지는 유지한다. 산책 경로를 비우면 플레이어
        // 목표로 잘못 떨어진다.
        const destination = this.currentPath[this.currentPath.length - 1];
        const detour =
          destination &&
          findPathFn(
            Math.floor(this.pixelX / TILE_SIZE),
            Math.floor(this.pixelY / TILE_SIZE),
            destination.x,
            destination.y,
            isWalkableFn,
          );
        if (detour?.length) {
          this.currentPath = detour;
          this.pathIndex = 0;
          this.stuckFrames = 0;
          this.lastDist = Infinity;
        }
        this.trafficBlockedMs = 0;
      }
      this.stopWalking();
      return "moving";
    }
    this.trafficBlockedMs = 0;
    this.actuallyWalking = true;
    const actualDx = nextX - this.pixelX,
      actualDy = nextY - this.pixelY;
    this.pixelX = nextX;
    this.pixelY = nextY;

    // 양보하느라 원래 경유지와 다른 쪽으로 움직일 수 있다 — 실제 이동 방향을 본다.
    if (Math.abs(actualDx) > Math.abs(actualDy)) {
      this.direction = actualDx > 0 ? DIR_RIGHT : DIR_LEFT;
    } else {
      this.direction = actualDy > 0 ? DIR_DOWN : DIR_UP;
    }

    this.syncView();
    return "moving";
  }

  private finishDestinationMove(): "arrived" {
    this.currentPath = null;
    this.moveState = "waiting";
    this.waitTimer = 0;
    this.destinationTag = null;
    this.destinationTarget = null;
    this.purposeAccessOrigin = null;
    this.stopWalking();
    return "arrived";
  }
}
