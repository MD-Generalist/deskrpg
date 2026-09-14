import { tiledDirection, tiledVariant } from "../../lib/tiled-geometry";
import { RemoteNpcPresentation } from "../remote-npc-presentation";
import {
  copyMotionContinuation,
  playerMotionGoal,
  type PlayerSpawnState,
  type PlayerMotionGoal,
} from "../runtime-hydration";
import { SpeechPreviews } from "../speech-previews";
import {
  MotionSnapshotCache,
  restoreOnSnapshot,
  untouchedSpawn,
  type MotionNpc,
  type MotionSnapshot,
} from "../motion-snapshot";
import { NpcMovementOwnership, publishNpcArrival } from "../npc-movement-ownership";
import { findPath, clearSegment, clearMovementSegment, type NavigationPoint } from "../navigation";
import { commitPlayerStep } from "../player-motion";
import { TrafficCoordinator, clearActors, findTrafficPath, type TrafficActor } from "../traffic";
import { peerMovementUncertainty, type PeerMotionSample } from "../peer-motion-envelope";
import {
  readAmbientZones,
  ambientTileAllowed,
  AmbientExitPolicy,
  type AmbientZone,
} from "../ambient-zones";
import { isSeatAnchor, commonAreaSeats } from "../three/seating";
import {
  AmbientDepartures,
  ambientAllowed,
  ambientDestinations,
  createAmbientSchedule,
  advanceAmbientSchedule,
  randomDuration,
  restAtAmbientSeat,
} from "../npc-ambient";
import Phaser from "phaser";
import { NpcSmalltalk } from "../npc-smalltalk";
import { resolveOfficeEnvironment } from "../three/office-environment-theme";
import { createEventScope } from "../three/event-scope";
import {
  matchesNpcTarget,
  worldToCamera,
  type OfficeBridge,
  type ActorSnapshot,
} from "../three/bridge";
import { fetchChannelNpcs } from "../npc-prefetch";
import { shouldAutoReturn, shouldReturnOnRoomChange } from "../npc-auto-return";
import { EventBus, pendingChannelData, setPendingChannelData } from "../EventBus";
import { decideNpcClick, shouldRememberTarget } from "@/game/npc-click-intent";
import { decideNpcUpdate, type NpcUpdatedPayload } from "@/game/npc-updated-dispatch";
import { createRejoinTracker, registerOnce, shouldRejoinForError } from "../socket-rejoin";
import type { Socket } from "socket.io-client";
import {
  MapObject,
  MapData,
  OBJECT_TYPES,
  OBJECT_TYPE_LIST,
  computeOccupiedTiles,
  detectAndConvertMapData,
  generateObjectId,
  canPlaceObject,
  getObjectDimensions,
} from "@/lib/object-types";
import { getCenteredCameraBounds } from "../camera-layout";

// ---------------------------------------------------------------------------
// Map constants
// ---------------------------------------------------------------------------

const MAP_COLS = 40;
const MAP_ROWS = 30;
const TILE_SIZE = 32;
const PLAYER_SPEED = 120;

// Sprite frame layout: 9 cols x 4 rows (walk-only sheet 576x256)
const SPRITE_COLS = 9;
const DIR_UP = 0;
const DIR_LEFT = 1;
const DIR_DOWN = 2;
const DIR_RIGHT = 3;

const MOVE_SEND_INTERVAL = 66;
const LERP_FACTOR = 0.2;
const NPC_INTERACT_RADIUS = 64;

const MINIMAP_SIZE = 150;
const MINIMAP_PADDING = 10;
const MINIMAP_TOP = 50;
const MAIN_CAMERA_ZOOM = 2;

const DIR_NAME_MAP: Record<string, number> = {
  up: DIR_UP,
  left: DIR_LEFT,
  down: DIR_DOWN,
  right: DIR_RIGHT,
};
const DIR_NUM_TO_NAME = ["up", "left", "down", "right"];

// Tile indices (must match BootScene tileset)
const T = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  DESK: 3,
  CHAIR: 4,
  COMPUTER: 5,
  PLANT: 6,
  DOOR: 7,
  MEETING_TABLE: 8,
  COFFEE: 9,
  WATER_COOLER: 10,
  BOOKSHELF: 11,
  CARPET: 12,
  WHITEBOARD: 13,
  RECEPTION_DESK: 14,
  CUBICLE_WALL: 15,
};

// Tiles that block movement (walls layer only; objects handled by objectOccupiedTiles)
const COLLISION_TILES = new Set([T.WALL]);

// Tile names for the editor toolbar
const TILE_NAMES = [
  "Empty",
  "Floor",
  "Wall",
  "Desk",
  "Chair",
  "Computer",
  "Plant",
  "Door",
  "Mtg Table",
  "Coffee",
  "Cooler",
  "Bookshelf",
  "Carpet",
  "Whiteboard",
  "Reception",
  "Cubicle",
];

// ---------------------------------------------------------------------------
// A* Pathfinding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Remote player wrapper
// ---------------------------------------------------------------------------

interface RemotePlayerData {
  id: string;
  userId?: string;
  characterName: string;
  appearance: unknown;
  x: number;
  y: number;
  direction: string;
  animation: string;
}

class RemotePlayer {
  userId?: string;
  appearance: unknown;
  sprite: Phaser.GameObjects.Sprite;
  nameLabel: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  direction: string;
  animation: string;
  textureKey: string;

  constructor(scene: Phaser.Scene, data: RemotePlayerData, textureKey: string) {
    this.userId = data.userId;
    this.textureKey = textureKey;
    this.appearance = data.appearance;
    this.targetX = data.x;
    this.targetY = data.y;
    this.direction = data.direction || "down";
    this.animation = data.animation || "idle";

    const dirIdx = DIR_NAME_MAP[this.direction] ?? DIR_DOWN;

    // Use textureKey if loaded, otherwise fallback placeholder
    const texKey = scene.textures.exists(textureKey) ? textureKey : "fallback-char";
    this.sprite = scene.add.sprite(data.x, data.y, texKey);
    if (texKey === textureKey) {
      this.sprite.setFrame(dirIdx * SPRITE_COLS);
    }
    this.sprite.setOrigin(0.5, 0.85);
    this.sprite.setDisplaySize(48, 48);

    this.nameLabel = scene.add.text(data.x, data.y - 44, data.characterName, {
      fontSize: "11px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
      align: "center",
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(20001);
  }

  updatePosition(x: number, y: number, direction: string, animation: string) {
    this.targetX = x;
    this.targetY = y;
    this.direction = direction;
    this.animation = animation;
  }

  lerpUpdate() {
    const dx = this.targetX - this.sprite.x;
    const dy = this.targetY - this.sprite.y;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      this.sprite.x = this.targetX;
      this.sprite.y = this.targetY;
    } else if (Math.abs(dx) > 200 || Math.abs(dy) > 200) {
      this.sprite.x = this.targetX;
      this.sprite.y = this.targetY;
    } else {
      this.sprite.x += dx * LERP_FACTOR;
      this.sprite.y += dy * LERP_FACTOR;
    }

    this.nameLabel.setPosition(this.sprite.x, this.sprite.y - 44);

    const dirIdx = DIR_NAME_MAP[this.direction] ?? DIR_DOWN;
    const animKey = `${this.textureKey}-walk-${this.direction}`;

    if (this.animation === "walk") {
      if (this.sprite.scene.anims.exists(animKey)) {
        this.sprite.anims.play(animKey, true);
      }
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(dirIdx * SPRITE_COLS);
    }
  }

  distanceTo(x: number, y: number): number {
    const dx = this.sprite.x - x;
    const dy = this.sprite.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private highlightGlow: Phaser.GameObjects.Graphics | null = null;
  private isHighlighted = false;

  setHighlight(on: boolean): void {
    if (on === this.isHighlighted) return;
    this.isHighlighted = on;
    if (on) {
      if (!this.highlightGlow) {
        this.highlightGlow = this.sprite.scene.add.graphics();
        this.highlightGlow.setDepth(20000);
      }
      this.highlightGlow.clear();
      this.highlightGlow.lineStyle(3, 0x60a5fa, 0.8);
      this.highlightGlow.strokeRoundedRect(this.sprite.x - 15, this.sprite.y - 39, 30, 48, 6);
      this.highlightGlow.lineStyle(5, 0x60a5fa, 0.3);
      this.highlightGlow.strokeRoundedRect(this.sprite.x - 17, this.sprite.y - 41, 34, 52, 8);
    } else {
      this.highlightGlow?.clear();
    }
  }

  updateHighlightPosition(): void {
    if (this.isHighlighted && this.highlightGlow) {
      this.highlightGlow.clear();
      this.highlightGlow.lineStyle(3, 0x60a5fa, 0.8);
      this.highlightGlow.strokeRoundedRect(this.sprite.x - 15, this.sprite.y - 39, 30, 48, 6);
      this.highlightGlow.lineStyle(5, 0x60a5fa, 0.3);
      this.highlightGlow.strokeRoundedRect(this.sprite.x - 17, this.sprite.y - 41, 34, 52, 8);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.nameLabel.destroy();
    this.highlightGlow?.destroy();
  }
}

// ---------------------------------------------------------------------------
// NPC wrapper
// ---------------------------------------------------------------------------

interface NpcData {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  direction: string;
  appearance?: unknown;
}

class NpcSprite {
  appearance: unknown;
  id: string;
  name: string;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  nameLabel: Phaser.GameObjects.Text;
  pixelX: number;
  pixelY: number;
  private scene: Phaser.Scene;
  direction: number;
  private textureKey: string | null = null; // stored for walk animations

  // Movement fields (runtime-only, not persisted)
  homeCol: number;
  homeRow: number;
  homeDirection: number;
  currentPath: { x: number; y: number }[] | null = null;
  pathIndex = 0;
  private trafficBlockedMs = 0;
  actuallyWalking = false;
  moveState: "idle" | "moving-to-player" | "waiting" | "returning" | "strolling" = "idle";
  ambientPaused = false;
  ambientTimer = 0;
  ambientSchedule = createAmbientSchedule();
  ambientSeat: { x: number; y: number } | null = null;
  ambientExitPolicy: AmbientExitPolicy | null = null;
  remoteWalkingUntil = 0;
  remotePresentation: RemoteNpcPresentation | null = null;
  motionLocallyDriven?: boolean;
  moveSpeed = 150; // px/s (faster than player's 120)
  pendingMessage: string | null = null;
  pendingReportId: string | null = null;
  pendingReportKind: string | null = null;
  arrivalBubbleText: string | null = null;
  waitDurationMs = 10000;
  /** 어느 방에서 불렀나 — null 이면 직접 부른 것. "r1" 같은 roomId 면 방에서 불렀으므로 그 방이 보이는 동안 자리로 돌아가지 않는다. */
  calledForRoom: string | null = null;
  private pathRecalcTimer = 0; // ms accumulated
  private stuckFrames = 0;
  private lastDist = Infinity;
  waitTimer = 0; // ms accumulated while in "waiting" state

  constructor(scene: Phaser.Scene, data: NpcData) {
    this.id = data.id;
    this.appearance = data.appearance;
    this.name = data.name;
    this.scene = scene;
    this.pixelX = data.positionX * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = data.positionY * TILE_SIZE + TILE_SIZE / 2;
    this.direction = DIR_NAME_MAP[data.direction] ?? DIR_DOWN;
    this.homeCol = data.positionX;
    this.homeRow = data.positionY;
    this.homeDirection = this.direction;

    const color = data.id === "sarah" ? 0xe879a0 : 0x5b9bd5;
    this.sprite = scene.add.rectangle(this.pixelX, this.pixelY, 28, 28, color);
    (this.sprite as Phaser.GameObjects.Rectangle).setStrokeStyle(2, 0xffffff);

    this.nameLabel = scene.add.text(this.pixelX, this.pixelY - 44, data.name, {
      fontSize: "11px",
      color: "#fbbf24",
      stroke: "#000000",
      strokeThickness: 3,
      align: "center",
      fontStyle: "bold",
    });
    this.nameLabel.setOrigin(0.5, 1);
    this.nameLabel.setDepth(20001);

    if (data.appearance) {
      const textureKey = `npc-${data.id}`;
      EventBus.emit("composite-remote-player", {
        id: data.id,
        appearance: data.appearance,
        textureKey,
      });

      const onReady = (result: { id: string; textureKey: string; dataUrl: string }) => {
        if (result.id !== data.id) return;
        EventBus.off("remote-spritesheet-ready", onReady);
        this.applyTexture(result.textureKey, result.dataUrl);
      };
      EventBus.on("remote-spritesheet-ready", onReady);
    }
  }

  private applyTexture(textureKey: string, dataUrl: string): void {
    if (!textureKey || !dataUrl) return;

    const img = new Image();
    img.onerror = () => {
      console.warn(`[NPC ${this.id}] Failed to load texture from dataUrl`);
    };
    img.onload = () => {
      try {
        // Use a unique key to avoid texture removal race conditions
        const uniqueKey = `${textureKey}-${Date.now()}`;
        const tex = this.scene.textures.addSpriteSheet(uniqueKey, img, {
          frameWidth: 64,
          frameHeight: 64,
        });
        if (!tex) return;

        const oldSprite = this.sprite;
        const newSprite = this.scene.add.sprite(this.pixelX, this.pixelY, uniqueKey);
        newSprite.setOrigin(0.5, 0.85);
        newSprite.setDisplaySize(48, 48);

        const idleFrame = this.direction * SPRITE_COLS;
        const totalFrames = tex.frameTotal - 1;
        if (idleFrame < totalFrames) {
          newSprite.setFrame(idleFrame);
        }
        this.sprite = newSprite;
        this.textureKey = uniqueKey;
        oldSprite.destroy();

        // Create walk animations for all 4 directions
        const walkDirs = [
          { name: "up", row: DIR_UP },
          { name: "left", row: DIR_LEFT },
          { name: "down", row: DIR_DOWN },
          { name: "right", row: DIR_RIGHT },
        ];
        for (const wd of walkDirs) {
          const wKey = `npc-${this.id}-walk-${wd.name}`;
          if (
            !this.scene.anims.exists(wKey) &&
            wd.row * SPRITE_COLS + SPRITE_COLS - 1 < totalFrames
          ) {
            this.scene.anims.create({
              key: wKey,
              frames: this.scene.anims.generateFrameNumbers(uniqueKey, {
                start: wd.row * SPRITE_COLS + 1,
                end: wd.row * SPRITE_COLS + SPRITE_COLS - 1,
              }),
              frameRate: 10,
              repeat: -1,
            });
          }
        }

        const animKey = `npc-${this.id}-idle-${Date.now()}`;
        const frame0 = this.direction * SPRITE_COLS;
        const frame1 = frame0 + 1;
        if (frame1 < totalFrames) {
          if (!this.scene.anims.exists(animKey)) {
            this.scene.anims.create({
              key: animKey,
              frames: [
                { key: uniqueKey, frame: frame0 },
                { key: uniqueKey, frame: frame1 },
              ],
              frameRate: 2,
              repeat: -1,
            });
            newSprite.play(animKey);
          }
        }
      } catch (err) {
        console.warn(`[NPC ${this.id}] Texture apply error:`, err);
      }
    };
    img.src = dataUrl;
  }

  private highlightGlow: Phaser.GameObjects.Graphics | null = null;
  private isHighlighted = false;

  setHighlight(on: boolean): void {
    if (on === this.isHighlighted) return;
    this.isHighlighted = on;

    if (on) {
      if (!this.highlightGlow) {
        this.highlightGlow = this.scene.add.graphics();
        this.highlightGlow.setDepth(20000);
      }
      this.highlightGlow.clear();
      this.highlightGlow.lineStyle(3, 0xfbbf24, 0.8);
      this.highlightGlow.strokeRoundedRect(this.pixelX - 15, this.pixelY - 39, 30, 48, 6);
      this.highlightGlow.lineStyle(5, 0xfbbf24, 0.3);
      this.highlightGlow.strokeRoundedRect(this.pixelX - 17, this.pixelY - 41, 34, 52, 8);
    } else {
      if (this.highlightGlow) {
        this.highlightGlow.clear();
      }
    }
  }

  distanceTo(x: number, y: number): number {
    const dx = this.pixelX - x;
    const dy = this.pixelY - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  destroy() {
    this.sprite.destroy();
    this.nameLabel.destroy();
    if (this.highlightGlow) this.highlightGlow.destroy();
  }

  updateName(name: string): void {
    this.name = name;
    this.nameLabel.setText(name);
  }

  updateDirection(direction: string): void {
    this.homeDirection = DIR_NAME_MAP[direction] ?? DIR_DOWN;
    this.direction = this.homeDirection;
    this.stopWalkAnimation();
  }

  updateAppearance(appearance: unknown): void {
    if (!appearance) return;
    this.appearance = appearance;
    const textureKey = `npc-${this.id}`;
    EventBus.emit("composite-remote-player", {
      id: this.id,
      appearance,
      textureKey,
    });

    const onReady = (result: { id: string; textureKey: string; dataUrl: string }) => {
      if (result.id !== this.id) return;
      EventBus.off("remote-spritesheet-ready", onReady);
      this.applyTexture(result.textureKey, result.dataUrl);
    };
    EventBus.on("remote-spritesheet-ready", onReady);
  }

  updateFromData(data: { name?: string; direction?: string; appearance?: unknown }): void {
    if (typeof data.name === "string" && data.name.trim()) {
      this.updateName(data.name);
    }
    if (typeof data.direction === "string") {
      this.updateDirection(data.direction);
    }
    if (data.appearance !== undefined) {
      this.updateAppearance(data.appearance);
    }
  }

  moveTo(
    targetCol: number,
    targetRow: number,
    findPathFn: (
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      walkable: (tx: number, ty: number) => boolean,
    ) => { x: number; y: number }[] | null,
    isWalkableFn: (tx: number, ty: number) => boolean,
    options?: {
      message?: string;
      reportId?: string;
      reportKind?: string;
      bubbleText?: string;
      waitDurationMs?: number;
    },
  ): boolean {
    const startCol = Math.floor(this.pixelX / TILE_SIZE);
    const startRow = Math.floor(this.pixelY / TILE_SIZE);

    // Path to player's tile directly — arrival is checked by NPC_INTERACT_RADIUS
    // so NPC will stop before actually overlapping the player
    const path = findPathFn(startCol, startRow, targetCol, targetRow, isWalkableFn);
    if (!path || path.length === 0) return false;

    this.currentPath = path;
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.pathRecalcTimer = 0;
    this.pendingMessage = options?.message || null;
    this.pendingReportId = options?.reportId || null;
    this.pendingReportKind = options?.reportKind || null;
    this.arrivalBubbleText = options?.bubbleText || null;
    this.waitDurationMs = options?.waitDurationMs ?? 10000;
    this.moveState = "moving-to-player";
    return true;
  }

  startStroll(path: { x: number; y: number }[]) {
    this.currentPath = path;
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.moveState = "strolling";
  }
  stopStroll() {
    if (this.moveState !== "strolling") return;
    this.currentPath = null;
    this.moveState = "idle";
    this.stopWalkAnimation();
  }

  cancelMovement() {
    this.currentPath = null;
    this.moveState = "idle";
    this.ambientPaused = false;
    this.remoteWalkingUntil = 0;
    this.pendingMessage = this.pendingReportId = this.pendingReportKind = null;
    this.stopWalkAnimation();
  }

  returnToHome(
    findPathFn: (
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      walkable: (tx: number, ty: number) => boolean,
    ) => { x: number; y: number }[] | null,
    isWalkableFn: (tx: number, ty: number) => boolean,
  ): boolean {
    this.calledForRoom = null;
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

    // An occupied or disconnected home remains a pending return; never teleport through walls.
    this.currentPath = findPathFn(startCol, startRow, this.homeCol, this.homeRow, isWalkableFn);
    this.pathIndex = 0;
    this.stuckFrames = 0;
    this.lastDist = Infinity;
    this.pathRecalcTimer = 0;
    this.pendingMessage = null;
    this.pendingReportId = null;
    this.pendingReportKind = null;
    this.arrivalBubbleText = null;
    this.waitDurationMs = 10000;
    this.moveState = "returning";
    return true;
  }

  private snapToHome(): void {
    this.pixelX = this.homeCol * TILE_SIZE + TILE_SIZE / 2;
    this.pixelY = this.homeRow * TILE_SIZE + TILE_SIZE / 2;
    this.direction = this.homeDirection;
    this.sprite.setPosition(this.pixelX, this.pixelY);
    this.nameLabel.setPosition(this.pixelX, this.pixelY - 44);
    if (this.highlightGlow) this.highlightGlow.clear();
    this.stopWalkAnimation();
  }

  pauseForSmalltalk(other: NpcSprite): void {
    // Keep the path and waypoint so the same stroll resumes after the exchange.
    if (this.moveState === "strolling") {
      const dx = other.pixelX - this.pixelX,
        dy = other.pixelY - this.pixelY;
      this.direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR_RIGHT : DIR_LEFT) : dy > 0 ? DIR_DOWN : DIR_UP;
    }
    this.stopWalkAnimation();
  }

  private stopWalkAnimation(): void {
    this.actuallyWalking = false;
    if (this.sprite instanceof Phaser.GameObjects.Sprite && this.textureKey) {
      this.sprite.stop();
      const idleFrame = this.direction * SPRITE_COLS;
      this.sprite.setFrame(idleFrame);
    }
  }

  updateMovement(
    delta: number,
    playerX: number,
    playerY: number,
    findPathFn: (
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      walkable: (tx: number, ty: number) => boolean,
    ) => { x: number; y: number }[] | null,
    isWalkableFn: (tx: number, ty: number) => boolean,
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
        this.moveState === "returning" ? this.homeCol : Math.floor(playerX / TILE_SIZE);
      const targetY =
        this.moveState === "returning" ? this.homeRow : Math.floor(playerY / TILE_SIZE);
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

    // --- Path recalculation (every 3s, only when moving toward player) ---
    if (this.moveState === "moving-to-player") {
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

      // --- Arrival check — close enough to interact (1 tile distance) ---
      const distToPlayer = this.distanceTo(playerX, playerY);
      if (distToPlayer < TILE_SIZE + 4) {
        // ~36px — right next to player
        this.currentPath = null;
        this.moveState = "waiting";
        const adx = playerX - this.pixelX;
        const ady = playerY - this.pixelY;
        if (Math.abs(adx) > Math.abs(ady)) {
          this.direction = adx > 0 ? DIR_RIGHT : DIR_LEFT;
        } else {
          this.direction = ady > 0 ? DIR_DOWN : DIR_UP;
        }
        this.stopWalkAnimation();
        this.waitTimer = 0;
        return "arrived";
      }
    }

    // --- Check if path is exhausted ---
    if (this.pathIndex >= this.currentPath.length) {
      if (this.moveState === "strolling") {
        this.stopStroll();
        return "idle";
      }
      if (this.moveState === "returning") {
        // Path ended — snap to home regardless of distance
        this.snapToHome();
        this.currentPath = null;
        this.moveState = "idle";
        return "returning-done";
      }
      // moving-to-player but path ended without reaching player — wait for recalc
      this.currentPath = null;
      return "moving";
    }

    // --- Follow path (matching player path-following pattern exactly) ---
    const target = this.currentPath[this.pathIndex];
    if (this.moveState === "strolling" && !isWalkableFn(target.x, target.y)) {
      this.stopStroll();
      return "idle";
    }
    const targetPx = target.x * TILE_SIZE + TILE_SIZE / 2;
    const targetPy = target.y * TILE_SIZE + TILE_SIZE / 2;

    const dx = targetPx - this.pixelX;
    const dy = targetPy - this.pixelY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Stuck detection (same as player)
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
      this.stopWalkAnimation();
      return "moving";
    }
    if (reached) {
      // Advance to next waypoint (NO snap — just like player)
      this.pathIndex++;
      this.stuckFrames = 0;
      this.lastDist = Infinity;

      // Check if path is now complete
      if (this.pathIndex >= this.currentPath.length) {
        if (this.moveState === "strolling") {
          this.stopStroll();
          return "idle";
        }
        if (this.moveState === "returning") {
          this.snapToHome();
          this.currentPath = null;
          this.moveState = "idle";
          this.stopWalkAnimation();
          return "returning-done";
        }
        // Path ended for moving-to-player, wait for next recalc cycle
        this.currentPath = null;
        this.stopWalkAnimation();
        return "moving";
      }
    }

    // Always move toward current waypoint (velocity-based, like player's setVelocity)
    const curTarget = this.currentPath[this.pathIndex];
    const curPx = curTarget.x * TILE_SIZE + TILE_SIZE / 2;
    const curPy = curTarget.y * TILE_SIZE + TILE_SIZE / 2;
    const cdx = curPx - this.pixelX;
    const cdy = curPy - this.pixelY;

    const moveAmount = Math.min(
      Math.hypot(cdx, cdy),
      (this.moveState === "strolling" ? 55 : this.moveSpeed) * (Math.min(delta, 100) / 1000),
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
      this.stopWalkAnimation();
      return "moving";
    }
    if (Math.hypot(nextX - this.pixelX, nextY - this.pixelY) < 1e-6) {
      this.trafficBlockedMs += Math.min(delta, 100);
      // A stationary actor can occupy an intermediate coarse waypoint forever.
      // Traffic cannot reach that waypoint; retry the complete route around it.
      if (this.trafficBlockedMs >= 1500) {
        // Preserve the stroll/seat destination, including when no detour exists.
        // Clearing a stroll path would accidentally fall back to the player target.
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
      this.stopWalkAnimation();
      return "moving";
    }
    this.trafficBlockedMs = 0;
    this.actuallyWalking = true;
    const actualDx = nextX - this.pixelX,
      actualDy = nextY - this.pixelY;
    this.pixelX = nextX;
    this.pixelY = nextY;

    // Yielding may move away from the original waypoint: face the actual movement.
    if (Math.abs(actualDx) > Math.abs(actualDy)) {
      this.direction = actualDx > 0 ? DIR_RIGHT : DIR_LEFT;
    } else {
      this.direction = actualDy > 0 ? DIR_DOWN : DIR_UP;
    }

    // Play walk animation for current direction
    if (this.sprite instanceof Phaser.GameObjects.Sprite && this.textureKey) {
      const walkKey = `npc-${this.id}-walk-${DIR_NUM_TO_NAME[this.direction]}`;
      if (this.scene.anims.exists(walkKey) && this.sprite.anims.currentAnim?.key !== walkKey) {
        this.sprite.play(walkKey, true);
      }
    }

    // Update visual positions every frame
    this.sprite.setPosition(this.pixelX, this.pixelY);
    this.nameLabel.setPosition(this.pixelX, this.pixelY - 44);
    if (this.highlightGlow) {
      this.highlightGlow.clear();
      if (this.isHighlighted) this.setHighlight(true);
    }

    return "moving";
  }
}

// ---------------------------------------------------------------------------
// GameScene
// ---------------------------------------------------------------------------

export class GameScene extends Phaser.Scene {
  private eventScope = createEventScope();
  private presentationPointer: { x: number; y: number } | null = null;
  private presentationActorId: string | undefined;
  private ambientDepartures = new AmbientDepartures();
  private traffic = new TrafficCoordinator();
  private npcOwnership = new NpcMovementOwnership();
  private connectedPlayerIds = new Set<string>();
  private peerPositions = new Map<
    string,
    { x: number; y: number; direction: string; animation: string }
  >();
  private motionSnapshot = new MotionSnapshotCache();
  private spawnRequest: { x: number; y: number } | null = null;
  private spawnInputStarted = false;
  private pendingSeatClaims = new Set<string>();
  private playerSeatGoal: string | null = null;
  private playerSpawnReady = false;
  private pendingPlayerResume: PlayerMotionGoal | null = null;
  private resumingPlayerGoal: PlayerMotionGoal | null = null;
  private lastSentMotion = "";
  private npcContinuationTimer = 0;
  private motionGeneration = 0;
  private peerSnapshotReady = false;
  private socketListenerCleanup: (() => void) | null = null;
  private pendingNpcCalls = new Map<
    string,
    {
      npcId: string;
      message?: string;
      reportId?: string;
      reportKind?: string;
      bubbleText?: string;
      npcName?: string;
      reason?: string;
      roomId?: string;
    }
  >();
  private applyMotionNpc(npc: NpcSprite, state: MotionNpc, force = false) {
    const previousOwner = this.npcOwnership.owner(npc.id);
    if (state.ownerSocketId) this.takeNpcOwnership(npc.id, state.ownerSocketId);
    else this.npcOwnership.clear(npc.id);
    if (state.phase === "returning") this.npcOwnership.startReturn(npc.id);
    const localDriver =
      state.ownerSocketId === this.socket?.id ||
      (!state.ownerSocketId && this.motionSnapshot.current?.ambientLeaderId === this.socket?.id);
    const reset =
      force ||
      npc.motionLocallyDriven !== localDriver ||
      previousOwner !== (state.ownerSocketId ?? undefined);
    npc.motionLocallyDriven = localDriver;
    npc.remotePresentation ??= new RemoteNpcPresentation(npc.pixelX, npc.pixelY);
    if (reset) {
      npc.cancelMovement();
      npc.pixelX = state.x;
      npc.pixelY = state.y;
      npc.direction = DIR_NAME_MAP[state.direction] ?? DIR_DOWN;
      npc.sprite.setPosition(state.x, state.y);
      npc.nameLabel.setPosition(state.x, state.y - 44);
      npc.remotePresentation.accept(state.x, state.y, true);
      this.traffic.clear(npc.id);
    } else if (!localDriver) {
      // Authoritative collision positions update now; presentation catches up per frame.
      npc.pixelX = state.x;
      npc.pixelY = state.y;
      npc.direction = DIR_NAME_MAP[state.direction] ?? DIR_DOWN;
      npc.remotePresentation.accept(state.x, state.y);
    }
    npc.remoteWalkingUntil = !localDriver && state.moving ? this.time.now + 500 : 0;
    if (force && state.continuation) {
      const restored = copyMotionContinuation(state.continuation);
      npc.ambientSchedule = restored.ambientSchedule;
      npc.ambientSeat = restored.ambientSeat ?? { x: npc.homeCol, y: npc.homeRow };
      npc.ambientTimer = restored.ambientTimer ?? 0;
      npc.ambientExitPolicy =
        restored.ambientSchedule.phase === "roam"
          ? new AmbientExitPolicy(this.ambientZones, {
              x: state.x / TILE_SIZE - 0.5,
              y: state.y / TILE_SIZE - 0.5,
            })
          : null;
      if (localDriver && state.phase === "ambient" && state.moving && restored.path?.length)
        npc.startStroll(restored.path);
    } else if (force && state.phase === "ambient") {
      npc.ambientSeat = { x: npc.homeCol, y: npc.homeRow };
      npc.ambientSchedule = {
        ...createAmbientSchedule(),
        phase: "roam",
        duration: 20000,
        ...(this.motionSnapshot.current?.seats.some((seat) => seat.actorId === npc.id)
          ? { seatRest: 10000, visitedSeat: true }
          : {}),
      };
    }
    if (localDriver && state.phase === "returning" && npc.moveState !== "returning") {
      npc.returnToHome(this.npcPathfinder(npc), this.createNpcWalkValidator());
      if (npc.moveState === "idle") this.finishNpcReturn(npc, true);
    } else if (localDriver && state.phase === "waiting" && npc.moveState !== "waiting") {
      npc.cancelMovement();
      npc.moveState = "waiting";
    }
    if (
      force &&
      localDriver &&
      state.phase === "called" &&
      this.player &&
      !this.pendingNpcCalls.has(npc.id)
    )
      EventBus.emit("npc:call-to-player", { npcId: npc.id });
    if (!state.ownerSocketId && previousOwner) {
      npc.calledForRoom = null;
      if (!state.continuation) npc.ambientSchedule = { ...createAmbientSchedule(), phase: "home" };
      EventBus.emit("npc:movement-returned", { npcId: npc.id });
    }
  }
  private restoreMotionNpc(npc: NpcSprite) {
    const state = this.motionSnapshot.current?.npcs.find((entry) => entry.npcId === npc.id);
    if (state) this.applyMotionNpc(npc, state, true);
    const pending = this.pendingNpcCalls.get(npc.id);
    if (pending && this.player && this.motionSnapshot.current) {
      this.pendingNpcCalls.delete(npc.id);
      EventBus.emit("npc:call-to-player", pending);
    }
  }
  private canMovePlayer(): boolean {
    return (
      !!this.socket?.connected &&
      this.playerSpawnReady &&
      this.peerSnapshotReady &&
      !!this.motionSnapshot.current
    );
  }
  private resumePlayerGoal(): void {
    if (!this.canMovePlayer() || !this.player || !this.pendingPlayerResume) return;
    const goal = this.pendingPlayerResume;
    this.pendingPlayerResume = null;
    this.resumingPlayerGoal = goal;
    const generation = this.motionGeneration;
    const resume = (accepted: boolean) => {
      if (this.resumingPlayerGoal === goal) this.resumingPlayerGoal = null;
      if (generation !== this.motionGeneration || this.spawnInputStarted || !this.player) {
        if (accepted && goal.seatId) this.releaseSeat(this.socket?.id ?? "");
        return;
      }
      if (!accepted) {
        this.currentPath = null;
        this.playerSeatGoal = null;
        this.clearPathLine();
        // An expired cached seat can already be beneath the restored avatar. Recover to
        // an unoccupied floor tile instead of visually sitting without a reservation.
        if (
          goal.seatId &&
          Math.hypot(goal.targetX - this.player.x, goal.targetY - this.player.y) <= 8
        ) {
          const col = Math.floor(this.player.x / TILE_SIZE),
            row = Math.floor(this.player.y / TILE_SIZE);
          let recovered = false;
          for (let radius = 1; radius < Math.max(MAP_COLS, MAP_ROWS) && !recovered; radius++) {
            for (let dx = -radius; dx <= radius && !recovered; dx++) {
              for (let dy = -radius; dy <= radius; dy++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const x = col + dx,
                  y = row + dy;
                if (
                  !this.isWalkable(x, y) ||
                  this.isTileOccupied(x, y) ||
                  isSeatAnchor(this.mapObjects, x, y)
                )
                  continue;
                this.player.setPosition((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
                this.playerNameLabel?.setPosition(this.player.x, this.player.y - 44);
                recovered = true;
                break;
              }
            }
          }
        }
        return;
      }
      this.playerSeatGoal = goal.seatId ?? null;
      if (Math.hypot(goal.targetX - this.player.x, goal.targetY - this.player.y) <= 2) return;
      const path = this.findPlayerPath(
        Math.floor(this.player.x / TILE_SIZE),
        Math.floor(this.player.y / TILE_SIZE),
        Math.floor(goal.targetX / TILE_SIZE),
        Math.floor(goal.targetY / TILE_SIZE),
      );
      if (path?.length) {
        this.currentPath = path;
        this.pathIndex = path.length > 1 ? 1 : 0;
        this.pathStuckTimer = 0;
        this.pathLastDist = Infinity;
        this.drawPathLine(path);
      } else if (goal.seatId) {
        this.releaseSeat(this.socket?.id ?? "");
        this.playerSeatGoal = null;
      }
    };
    if (goal.seatId && this.socket?.id)
      this.reserveSeat(this.socket.id, goal.targetX, goal.targetY, resume);
    else resume(true);
  }
  private updateRemoteNpcPresentation(): void {
    for (const npc of this.npcSprites) {
      if (npc.motionLocallyDriven !== false || !npc.remotePresentation) continue;
      const view = npc.remotePresentation;
      view.step(this.game.loop.delta);
      npc.sprite.setPosition(view.x, view.y);
      npc.nameLabel.setPosition(view.x, view.y - 44);
      const bubble = this.npcBubbles.get(npc.id);
      bubble?.setPosition(view.x, view.y - 44);
      if (npc.sprite instanceof Phaser.GameObjects.Sprite) {
        if (!view.walking) {
          npc.sprite.stop();
          npc.sprite.setFrame(npc.direction * SPRITE_COLS);
        } else {
          const key = `npc-${npc.id}-walk-${DIR_NUM_TO_NAME[npc.direction]}`;
          if (this.anims.exists(key) && npc.sprite.anims.currentAnim?.key !== key)
            npc.sprite.play(key, true);
        }
      }
    }
  }
  private npcContinuation(npc: NpcSprite) {
    return copyMotionContinuation({
      ambientSchedule: npc.ambientSchedule,
      ambientSeat: npc.ambientSeat ?? { x: npc.homeCol, y: npc.homeRow },
      ambientTimer: npc.ambientTimer,
      path: npc.currentPath?.slice(npc.pathIndex, npc.pathIndex + 256),
    });
  }
  private reserveSeat(actorId: string, x: number, y: number, done: (accepted: boolean) => void) {
    if (!this.socket?.connected || !this.motionSnapshot.current) {
      done(false);
      return;
    }
    const seatId = `${x}:${y}`;
    const existing = this.motionSnapshot.current.seats.find((seat) => seat.seatId === seatId);
    if (existing?.actorId === actorId) {
      done(true);
      return;
    }
    if (existing || this.pendingSeatClaims.has(actorId)) {
      done(false);
      return;
    }
    this.pendingSeatClaims.add(actorId);
    const generation = this.motionGeneration;
    const channelId = this.channelId;
    const socket = this.socket;
    socket
      .timeout(3000)
      .emit(
        "seat:claim",
        { channelId, seatId, actorId },
        (error: Error | null, result?: { ok: boolean }) => {
          if (
            generation !== this.motionGeneration ||
            socket !== this.socket ||
            channelId !== this.channelId
          ) {
            // The same Socket object may already own a newer claim after reconnect.
            // Server departure/approach lease cleanup owns obsolete reservations.
            return;
          }
          this.pendingSeatClaims.delete(actorId);
          done(!error && !!result?.ok);
        },
      );
  }
  private releaseSeat(actorId: string) {
    this.socket?.emit("seat:release", { channelId: this.channelId, actorId });
  }
  private isAmbientLeader() {
    return (
      !!this.socket?.connected &&
      this.peerSnapshotReady &&
      !!this.motionSnapshot.current &&
      this.motionSnapshot.current.ambientLeaderId === this.socket.id
    );
  }
  private mayDriveNpc(npc: NpcSprite) {
    return (
      !!this.socket?.connected &&
      this.peerSnapshotReady &&
      !!this.motionSnapshot.current &&
      this.npcOwnership.mayDrive(npc.id, this.socket.id, this.isAmbientLeader())
    );
  }
  private takeNpcOwnership(npcId: string, ownerId: string) {
    if (!this.npcOwnership.claim(npcId, ownerId)) return;
    const npc = this.npcSprites.find((entry) => entry.id === npcId);
    if (npc) {
      npc.cancelMovement();
      npc.calledForRoom = null;
      delete npc.ambientSchedule.seatTarget;
      delete npc.ambientSchedule.seatRest;
      this.traffic.clear(npcId);
    }
  }
  private ensureLocalNpcOwnership(npc: NpcSprite, reason?: string, roomId?: string) {
    if (!this.socket?.connected || !this.socket.id || !this.motionSnapshot.current) return false;
    if (this.npcOwnership.owner(npc.id) === this.socket.id) return true;
    this.takeNpcOwnership(npc.id, this.socket.id);
    this.socket.emit("npc:call", {
      channelId: this.channelId,
      npcId: npc.id,
      ...(reason ? { reason } : {}),
      ...(roomId ? { roomId } : {}),
    });
    return true;
  }
  private finishNpcReturn(npc: NpcSprite, publish: boolean) {
    const position = { x: npc.pixelX, y: npc.pixelY };
    const home = { x: (npc.homeCol + 0.5) * TILE_SIZE, y: (npc.homeRow + 0.5) * TILE_SIZE };
    if (publish)
      publishNpcArrival((event, payload) => this.socket?.emit(event, payload), {
        channelId: this.channelId,
        npcId: npc.id,
        ...position,
        direction: DIR_NUM_TO_NAME[npc.direction],
      });
    if (this.npcOwnership.finishReturn(npc.id, position, home)) {
      npc.ambientSchedule = createAmbientSchedule();
      npc.calledForRoom = null;
      npc.remoteWalkingUntil = 0;
      this.traffic.clear(npc.id);
      EventBus.emit("npc:movement-returned", { npcId: npc.id });
    }
  }
  private releaseNpcOwner(ownerId: string) {
    for (const npcId of this.npcOwnership.releaseOwner(ownerId)) {
      const npc = this.npcSprites.find((entry) => entry.id === npcId);
      if (!npc) continue;
      npc.cancelMovement();
      npc.calledForRoom = null;
      npc.ambientSchedule = { ...createAmbientSchedule(), phase: "home" };
      this.traffic.clear(npcId);
      EventBus.emit("npc:movement-returned", { npcId });
    }
  }
  private speechPreviews = new SpeechPreviews();
  private smalltalk = new NpcSmalltalk();
  private responsePhases: Record<string, "queued" | "thinking" | "streaming"> = {};

  /** Reuse authoritative frontend simulation while Three.js owns presentation. */
  readonly officeBridge: OfficeBridge = {
    actors: () => {
      const texture = (sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle) =>
        sprite instanceof Phaser.GameObjects.Sprite
          ? (sprite.texture.getSourceImage() as CanvasImageSource)
          : undefined;
      const actors: ActorSnapshot[] = this.npcSprites.map((npc) => {
        const bubble = this.npcBubbles.get(npc.id);
        const label = bubble?.list.find((child) => child instanceof Phaser.GameObjects.Text) as
          Phaser.GameObjects.Text | undefined;
        return {
          id: npc.id,
          name: npc.name,
          kind: "npc",
          x: npc.sprite.x,
          y: npc.sprite.y,
          direction: DIR_NUM_TO_NAME[npc.direction],
          walking:
            !npc.ambientPaused &&
            (this.mayDriveNpc(npc)
              ? npc.actuallyWalking
              : (npc.remotePresentation?.walking ?? npc.remoteWalkingUntil > this.time.now)),
          texture: texture(npc.sprite),
          appearance: npc.appearance,
          bubble:
            this.speechPreviews.get(npc.id, this.time.now) ||
            (bubble
              ? label?.text || "···"
              : !this.responsePhases[npc.id] &&
                  !this.activityBubbles.has(npc.id) &&
                  !npc.calledForRoom &&
                  !this.dialogOpen
                ? this.smalltalk.text(npc.id, this.time.now)
                : undefined),
          active: this.activityBubbles.has(npc.id),
          phase: this.responsePhases[npc.id],
        };
      });
      if (this.playerReady && this.player)
        actors.push({
          id: this.socket?.id || this.characterId || "local",
          name: this.characterName,
          kind: "player",
          x: this.player.x,
          y: this.player.y,
          direction: DIR_NUM_TO_NAME[this.currentDirection],
          walking: this.playerActuallyWalking,
          texture: texture(this.player),
          appearance: this.appearance,
          bubble: this.speechPreviews.get(
            this.socket?.id || this.characterId || "local",
            this.time.now,
          ),
        });
      for (const [id, remote] of this.remotePlayers)
        actors.push({
          id,
          userId: remote.userId,
          name: remote.nameLabel.text,
          kind: "remote",
          x: remote.sprite.x,
          y: remote.sprite.y,
          direction: remote.direction,
          walking: remote.animation !== "idle",
          texture: texture(remote.sprite),
          appearance: remote.appearance,
          bubble: this.speechPreviews.get(remote.userId || id, this.time.now),
        });
      return actors;
    },
    mapKey: () =>
      JSON.stringify([
        this.effectiveMapCols,
        this.effectiveMapRows,
        this.floorData,
        this.wallsData,
        this.mapObjects,
        this.tiledMode,
        this.officeEnvironment,
        this.foregroundTileSprites.length,
        this.textures.getTextureKeys().length,
      ]),
    save: () => (this.isChannelOwner && !this.tiledMode ? this.saveMap() : Promise.resolve(false)),
    map: () => {
      const blocked: string[] = [];
      for (let row = 0; row < this.effectiveMapRows; row++)
        for (let col = 0; col < this.effectiveMapCols; col++) {
          if (!this.isWalkable(col, row)) blocked.push(`${col},${row}`);
        }
      // Preserve custom tileset artwork using the already loaded, same-origin assets.
      const artwork = document.createElement("canvas");
      artwork.width = this.effectiveMapCols * TILE_SIZE;
      artwork.height = this.effectiveMapRows * TILE_SIZE;
      const ctx = artwork.getContext("2d");
      if (ctx && this.tiledMode) {
        ctx.imageSmoothingEnabled = false;
        const foreground = new Set<Phaser.GameObjects.GameObject>(this.foregroundTileSprites);
        for (const child of [...this.children.list].sort(
          (a, b) =>
            ((a as unknown as { depth?: number }).depth || 0) -
            ((b as unknown as { depth?: number }).depth || 0),
        )) {
          if (child instanceof Phaser.GameObjects.Sprite && foreground.has(child)) {
            const frame = child.frame;
            ctx.save();
            ctx.globalAlpha = child.alpha;
            ctx.translate(child.x, child.y);
            ctx.rotate(child.rotation);
            ctx.scale(child.flipX ? -1 : 1, child.flipY ? -1 : 1);
            ctx.drawImage(
              child.texture.getSourceImage() as CanvasImageSource,
              frame.cutX,
              frame.cutY,
              frame.cutWidth,
              frame.cutHeight,
              -child.displayWidth * child.originX,
              -child.displayHeight * child.originY,
              child.displayWidth,
              child.displayHeight,
            );
            ctx.restore();
            continue;
          }
          if (
            !(child instanceof Phaser.Tilemaps.TilemapLayer) ||
            child.layer.name.toLowerCase() === "collision" ||
            !child.visible
          )
            continue;
          for (const row of child.layer.data)
            for (const tile of row) {
              if (!tile || tile.index < 0 || !tile.tileset?.image) continue;
              const tileset = tile.tileset;
              const source = tileset.image!.getSourceImage() as CanvasImageSource;
              const uv = tileset.getTileTextureCoordinates(tile.index) as {
                x: number;
                y: number;
              } | null;
              if (!uv) continue;
              ctx.save();
              ctx.globalAlpha = child.alpha * tile.alpha;
              ctx.translate(tile.x * TILE_SIZE + 16, tile.y * TILE_SIZE + 16);
              ctx.rotate(tile.rotation);
              ctx.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
              ctx.drawImage(
                source,
                uv.x,
                uv.y,
                tileset.tileWidth,
                tileset.tileHeight,
                -16,
                -16,
                32,
                32,
              );
              ctx.restore();
            }
        }
      }
      return {
        cols: this.effectiveMapCols,
        rows: this.effectiveMapRows,
        floor: this.floorData,
        walls: this.wallsData,
        blocked,
        objects: this.mapObjects,
        tiled: this.tiledMode,
        environment: this.officeEnvironment,
        artwork: this.tiledMode ? artwork : undefined,
      };
    },
    editor: () => ({
      enabled: this.editorMode,
      objects: this.editorObjectMode,
      tile: this.selectedTile,
      layer: this.selectedLayer,
      objectType: this.selectedObjectType,
      placement: this.placementMode,
      spawn: this.spawnSetMode,
      owner: this.isChannelOwner,
      tiled: this.tiledMode,
    }),
    edit: (options) => {
      if (!this.isChannelOwner) return;
      if (options.enabled !== undefined && options.enabled !== this.editorMode) this.toggleEditor();
      if (options.objects !== undefined) this.editorObjectMode = options.objects;
      if (options.tile !== undefined) this.selectedTile = Math.max(0, Math.min(15, options.tile));
      if (options.layer !== undefined) this.selectedLayer = options.layer === 1 ? 1 : 0;
      if (options.objectType && OBJECT_TYPES[options.objectType])
        this.selectedObjectType = options.objectType;
      this.updateLayerText();
    },
    pointer: (kind, x, y, button, screenX, screenY, actorId) => {
      if (this.editorMode && this.tiledMode) return;
      this.cameras.main.preRender();
      const point = worldToCamera(x, y, this.cameras.main);
      this.input.activePointer.position.set(point.x, point.y);
      const pointer = {
        ...point,
        rightButtonDown: () => button === 2,
        leftButtonDown: () => button === 0,
      };
      this.presentationPointer = { x: screenX, y: screenY };
      this.presentationActorId = actorId;
      this.input.emit(kind === "down" ? "pointerdown" : "pointermove", pointer);
      this.presentationPointer = null;
      this.presentationActorId = undefined;
    },
    walkable: (col, row) => this.isWalkable(col, row) && !this.isTileOccupied(col, row),
    setPresentation: (active) => {
      this.sys.settings.visible = !active;
    },
  };

  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private currentDirection: number = DIR_DOWN;
  private playerReady = false;
  private playerActuallyWalking = false;

  // Multiplayer
  private socket: Socket | null = null;
  private rejoin = createRejoinTracker();
  private joinedSocketId: string | undefined = undefined;
  private handleSocketDisconnect = () => {
    this.rejoin.onDisconnect();
    this.motionSnapshot.clear();
    this.peerSnapshotReady = false;
    this.playerSpawnReady = false;
    this.pendingPlayerResume = null;
    this.resumingPlayerGoal = null;
    this.motionGeneration++;
    this.pendingSeatClaims.clear();
  };
  private handleSocketConnect = () => {
    const reconnect = this.rejoin.shouldRejoin(this.playerReady && !!this.player);
    if (this.playerReady && this.player && (reconnect || this.joinedSocketId !== this.socket?.id)) {
      this.joinMultiplayer(this.player.x, this.player.y);
    }
  };
  // 이 경로는 connect 트래커와 경쟁한다: 재연결 시 socket.io-client 가 버퍼링된
  // chat:send 를 유저 connect 리스너보다 먼저 플러시해, 서버의 chat:error not_joined 가
  // connect 핸들러의 join 뒤에 도착할 수 있다. 소켓 id 로 중복을 걸러낸다
  // (src/game/socket-rejoin.ts 의 shouldRejoinForError 주석 참조).
  private handleSocketRejoin = () => {
    if (!this.playerReady || !this.player) return;
    if (!shouldRejoinForError(this.socket?.id, this.joinedSocketId)) return;
    this.joinMultiplayer(this.player.x, this.player.y);
  };
  private remotePlayers = new Map<string, RemotePlayer>();
  private peerMotionSamples = new Map<string, PeerMotionSample>();
  private lastMoveSent = 0;
  private lastSentX = 0;
  private lastSentY = 0;
  private lastSentDir = "";
  private lastSentAnim = "";
  private characterId = "";
  private characterName = "";
  private appearance: unknown = null;

  // NPCs
  private npcSprites: NpcSprite[] = [];
  private npcTilePositions: Set<string> = new Set(); // "col,row" for spawn collision check
  private npcPositionSyncTimer = 0;
  private nearbyNpcs: NpcSprite[] = [];
  private nearbyPlayers: { id: string; name: string }[] = [];
  private dialogOpen = false;
  /** 어느 방의 대화가 보이는가 — GamePageClient 가 room:visible 로 알려 준다. null 이면 보이는 방이 없음. */
  private visibleRoomId: string | null = null;
  private lastToastMessage: string | null = null;
  private lastChatInputEnabled: boolean | null = null;
  private editorKeys: {
    one?: Phaser.Input.Keyboard.Key;
    two?: Phaser.Input.Keyboard.Key;
    three?: Phaser.Input.Keyboard.Key;
    oKey?: Phaser.Input.Keyboard.Key;
  } = {};
  private editorObjectMode = false;
  private selectedObjectType: string = "desk";
  private editorObjectPreview: Phaser.GameObjects.Sprite | null = null;

  // Minimap
  private minimap: Phaser.Cameras.Scene2D.Camera | null = null;
  private minimapBorder: Phaser.GameObjects.Graphics | null = null;

  // Path following
  private currentPath: { x: number; y: number }[] | null = null;
  private pathIndex: number = 0;
  private targetNpcId: string | null = null;
  private pathLine: Phaser.GameObjects.Graphics | null = null;
  private pathStuckTimer: number = 0;
  private pathLastDist: number = Infinity;

  // Map layers data (for walkability and editor)
  private floorData: number[][] = [];
  private wallsData: number[][] = [];
  private collisionData: number[][] = []; // Tiled Collision layer data
  private effectiveMapCols: number = MAP_COLS;
  private effectiveMapRows: number = MAP_ROWS;
  private currentMapPixelWidth: number = MAP_COLS * TILE_SIZE;
  private currentMapPixelHeight: number = MAP_ROWS * TILE_SIZE;
  private mapObjects: MapObject[] = [];
  private objectSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private ySortObjectSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private objectOccupiedTiles = new Set<string>();

  // Tilemap references
  private floorLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private wallsLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  // Individual sprites for foreground tile layers (depth >= 10000), for per-tile y-sort
  private foregroundTileSprites: Phaser.GameObjects.Sprite[] = [];

  // Auto-greeting tracking
  private greetedNpcs: Set<string> = new Set();

  // Editor state
  private editorMode = false;
  private selectedTile = 1;
  private selectedLayer = 0; // 0=floor, 1=walls
  private editorToolbar: Phaser.GameObjects.Container | null = null;
  private gridOverlay: Phaser.GameObjects.Graphics | null = null;
  private editorLayerText: Phaser.GameObjects.Text | null = null;
  private editorCursor: Phaser.GameObjects.Graphics | null = null;
  private editorSelectedHighlight: Phaser.GameObjects.Graphics | null = null;

  // Channel
  private channelId: string = "";
  private channelMapData: MapData | null = null;
  private tiledMode: boolean = false; // true when using Tiled JSON map (not legacy tilemap)
  private officeEnvironment: string | undefined;
  private ambientZones: AmbientZone[] = [];
  private tiledSpawnCol: number | null = null;
  private tiledSpawnRow: number | null = null;
  private savedPosition: { x: number; y: number } | null = null;

  // Player name label
  private playerNameLabel: Phaser.GameObjects.Text | null = null;

  // Placement mode (NPC hiring)
  private placementMode = false;
  private placementNpcId: string | null = null;
  private canPlaceAt(col: number, row: number): boolean {
    return (
      isSeatAnchor(this.mapObjects, col, row) &&
      this.isWalkable(col, row) &&
      !this.npcSprites.some(
        (n) => n.id !== this.placementNpcId && n.homeCol === col && n.homeRow === row,
      )
    );
  }
  private placementHighlight: Phaser.GameObjects.Rectangle | null = null;
  private isChannelOwner = false;

  // Spawn set mode (channel owner sets spawn point)
  private spawnSetMode = false;
  private spawnHighlight: Phaser.GameObjects.Rectangle | null = null;
  private mapConfigSpawnCol: number | null = null;
  private mapConfigSpawnRow: number | null = null;
  private reportWaitMs = 20000;

  constructor() {
    super({ key: "GameScene" });
  }

  private applyMainCameraBounds(mapWidth: number, mapHeight: number): void {
    this.currentMapPixelWidth = mapWidth;
    this.currentMapPixelHeight = mapHeight;
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);

    const bounds = getCenteredCameraBounds({
      viewportWidth: this.cameras.main.width,
      viewportHeight: this.cameras.main.height,
      zoom: this.cameras.main.zoom || MAIN_CAMERA_ZOOM,
      mapWidth,
      mapHeight,
    });

    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  private isWalkable(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.effectiveMapCols || tileY < 0 || tileY >= this.effectiveMapRows)
      return false;
    // Check Collision layer (Tiled maps)
    if (this.collisionData.length > 0) {
      const collisionGid = this.collisionData[tileY]?.[tileX] ?? 0;
      if (collisionGid !== 0) return false;
    }
    // Legacy walls check
    if (this.wallsData.length > 0 && this.collisionData.length === 0) {
      const wallTile = this.wallsData[tileY]?.[tileX] ?? T.EMPTY;
      if (COLLISION_TILES.has(wallTile)) return false;
    }
    // Check object occupied tiles
    if (this.objectOccupiedTiles.has(`${tileX},${tileY}`)) return false;
    return true;
  }

  private trafficActors(): TrafficActor[] {
    const point = (x: number, y: number) => ({ x: x / TILE_SIZE - 0.5, y: y / TILE_SIZE - 0.5 });
    return [
      ...this.npcSprites.map((npc) => ({ id: npc.id, ...point(npc.pixelX, npc.pixelY) })),
      ...[...this.peerPositions].map(([id, remote]) => ({
        id: `player:${id}`,
        player: true,
        ...point(remote.x, remote.y),
        movementUncertainty: peerMovementUncertainty(
          this.peerMotionSamples.get(id) ?? {
            receivedAt: performance.now(),
            moving: remote.animation === "walk",
          },
          performance.now(),
          this.game.loop.delta,
        ),
      })),
      ...(this.player
        ? [{ id: "player:local", player: true, ...point(this.player.x, this.player.y) }]
        : []),
    ];
  }

  private findPlayerPath(sx: number, sy: number, ex: number, ey: number) {
    const actors = this.trafficActors().filter((actor) => actor.id !== "player:local");
    const walkable = (x: number, y: number) => this.isWalkable(x, y);
    return (
      findPath(sx, sy, ex, ey, walkable, (a, b) => clearActors(a, b, actors)) ??
      findPath(sx, sy, ex, ey, walkable)
    );
  }

  private npcPathfinder(npc: NpcSprite) {
    return (
      sx: number,
      sy: number,
      ex: number,
      ey: number,
      walkable: (x: number, y: number) => boolean,
    ) => {
      const actors = this.trafficActors().filter((actor) => actor.id !== npc.id);
      return findTrafficPath(sx, sy, ex, ey, walkable, actors);
    };
  }

  private createNpcWalkValidator(): (tx: number, ty: number) => boolean {
    // Coarse paths describe static topology; traffic handles transient actors using swept discs.
    return (tx, ty) => this.isWalkable(tx, ty);
  }

  private drawPathLine(path: { x: number; y: number }[]): void {
    if (!this.pathLine) {
      this.pathLine = this.add.graphics();
      this.pathLine.setDepth(20003);
    }
    const g = this.pathLine;
    g.clear();

    g.fillStyle(0xfbbf24, 0.4);
    for (let i = 1; i < path.length; i++) {
      const px = path[i].x * TILE_SIZE + TILE_SIZE / 2;
      const py = path[i].y * TILE_SIZE + TILE_SIZE / 2;
      g.fillCircle(px, py, 3);
    }

    if (path.length >= 2) {
      g.lineStyle(1.5, 0xfbbf24, 0.3);
      g.beginPath();
      g.moveTo(path[0].x * TILE_SIZE + TILE_SIZE / 2, path[0].y * TILE_SIZE + TILE_SIZE / 2);
      for (let i = 1; i < path.length; i++) {
        g.lineTo(path[i].x * TILE_SIZE + TILE_SIZE / 2, path[i].y * TILE_SIZE + TILE_SIZE / 2);
      }
      g.strokePath();
    }

    const last = path[path.length - 1];
    g.fillStyle(0xfbbf24, 0.6);
    g.fillCircle(last.x * TILE_SIZE + TILE_SIZE / 2, last.y * TILE_SIZE + TILE_SIZE / 2, 5);
  }

  private clearPathLine(): void {
    if (this.pathLine) {
      this.pathLine.clear();
    }
  }

  private findNearestWalkableTile(tileX: number, tileY: number): { x: number; y: number } | null {
    for (let radius = 1; radius < Math.max(MAP_COLS, MAP_ROWS); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const nx = tileX + dx;
          const ny = tileY + dy;
          if (this.isWalkable(nx, ny) && !this.isTileOccupied(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  create(): void {
    this.officeEnvironment = undefined;
    this.ambientZones = [];
    this.traffic.clear();
    this.joinedSocketId = undefined;
    this.npcOwnership.clear();
    this.motionSnapshot.clear();
    this.peerPositions.clear();
    this.peerMotionSamples.clear();
    this.pendingNpcCalls.clear();
    this.motionGeneration++;
    this.connectedPlayerIds.clear();
    // Read pending channel data set by game page before scene creation
    let tiledJsonData: Record<string, unknown> | null = null;
    const initialChannelData = pendingChannelData;

    if (initialChannelData) {
      this.channelId = initialChannelData.channelId;

      if (initialChannelData.tiledJson) {
        // Explicit Tiled JSON passed from game page
        tiledJsonData = initialChannelData.tiledJson as Record<string, unknown>;
      } else if (initialChannelData.mapData) {
        // Check if mapData IS Tiled JSON (has tiledversion field)
        const mapData = initialChannelData.mapData as Record<string, unknown>;
        if ("tiledversion" in mapData) {
          tiledJsonData = mapData;
        } else {
          this.channelMapData = detectAndConvertMapData(mapData, MAP_COLS, MAP_ROWS);
        }
      }

      // Store spawn from mapConfig if available
      if (initialChannelData.mapConfig) {
        const config = initialChannelData.mapConfig as Record<string, unknown>;
        if (typeof config.spawnCol === "number") {
          this.tiledSpawnCol = config.spawnCol;
          this.mapConfigSpawnCol = config.spawnCol;
        }
        if (typeof config.spawnRow === "number") {
          this.tiledSpawnRow = config.spawnRow;
          this.mapConfigSpawnRow = config.spawnRow;
        }
      }

      // Restore saved position from last session
      if (initialChannelData.savedPosition) {
        this.savedPosition = initialChannelData.savedPosition;
      }

      if (typeof initialChannelData.reportWaitSeconds === "number") {
        this.reportWaitMs = Math.max(5000, initialChannelData.reportWaitSeconds * 1000);
      }

      setPendingChannelData(null); // consumed
    }

    if (tiledJsonData) {
      // Tiled JSON path — use Phaser's built-in Tiled JSON loader
      this.loadTiledMap(tiledJsonData);
    } else if (this.channelMapData) {
      this.floorData = this.channelMapData.layers.floor;
      this.wallsData = this.channelMapData.layers.walls;
      this.mapObjects = this.channelMapData.objects;

      this.createTilemap();
      this.renderObjects();
    } else {
      const waitingText = this.add
        .text(this.scale.width / 2, this.scale.height / 2, "Loading channel map...", {
          fontSize: "20px",
          color: "#ffffff",
          backgroundColor: "#111827",
          padding: { x: 12, y: 8 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(20000);

      const handleChannelDataReady = () => {
        EventBus.off("channel-data-ready", handleChannelDataReady);
        if (waitingText.active) waitingText.destroy();
        this.scene.restart();
      };

      this.eventScope.on("channel-data-ready", handleChannelDataReady);
      const cleanupChannelDataListener = () => {
        EventBus.off("channel-data-ready", handleChannelDataReady);
        if (waitingText.active) waitingText.destroy();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupChannelDataListener);
      this.events.once(Phaser.Scenes.Events.DESTROY, cleanupChannelDataListener);
      return;
    }

    // Input keys
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.interactKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH,
        false,
        false,
      );
      this.editorKeys = {
        one: this.input.keyboard.addKey("ONE", false, false),
        two: this.input.keyboard.addKey("TWO", false, false),
        three: this.input.keyboard.addKey("THREE", false, false),
        oKey: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.O, false, false),
      };

      // Disable Phaser key capture when HTML inputs are focused
      // keyboard.enabled alone is not enough — addKey registers captures
      // at the KeyboardManager level which call preventDefault regardless.
      // We must call removeCapture/addCapture to truly release keys.
      const kbd = this.input.keyboard;
      const capturedKeys = [
        Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
      ];
      // Capture keys immediately on scene init so the browser never intercepts them
      // (e.g. Firefox Quick Find on '/', browser scroll on Space/Arrow keys).
      // addKey() with enableCapture=false only tracks the key without capture,
      // so we must call addCapture explicitly here.
      kbd.addCapture(capturedKeys);
      const shouldReleaseKeyboardCapture = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        const tag = el.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
      };
      // Editor keys (ONE, TWO, THREE, O) are NOT captured globally —
      // they only work in editor mode which is not active during dialogs
      const handleFocusIn = (e: FocusEvent) => {
        if (!kbd) return;
        if (shouldReleaseKeyboardCapture(e.target)) {
          kbd.enabled = false;
          kbd.removeCapture(capturedKeys);
        }
      };
      const handleFocusOut = () => {
        if (!kbd) return;
        kbd.enabled = false;
        this.time.delayedCall(50, () => {
          if (!kbd) return;
          if (shouldReleaseKeyboardCapture(document.activeElement)) {
            return;
          }
          kbd.addCapture(capturedKeys);
          kbd.enabled = true;
        });
      };
      document.addEventListener("focusin", handleFocusIn);
      document.addEventListener("focusout", handleFocusOut);
      this.eventScope.addCleanup(() => {
        document.removeEventListener("focusin", handleFocusIn);
        document.removeEventListener("focusout", handleFocusOut);
      });
    }

    const mapWidth = MAP_COLS * TILE_SIZE;
    const mapHeight = MAP_ROWS * TILE_SIZE;

    this.cameras.main.setZoom(MAIN_CAMERA_ZOOM);
    this.applyMainCameraBounds(mapWidth, mapHeight);
    this.cameras.main.setRoundPixels(true);

    // Minimap
    const minimap = this.cameras.add(
      this.scale.width - MINIMAP_SIZE - MINIMAP_PADDING,
      MINIMAP_TOP,
      MINIMAP_SIZE,
      MINIMAP_SIZE,
    );
    minimap.setZoom(MINIMAP_SIZE / Math.max(mapWidth, mapHeight));
    minimap.setBackgroundColor(0x1a1a2e);
    minimap.setBounds(0, 0, mapWidth, mapHeight);
    minimap.setScroll(0, 0);
    this.minimap = minimap;

    // Minimap border — theme-colored stroke
    const borderGfx = this.add.graphics();
    borderGfx.setScrollFactor(0);
    borderGfx.setDepth(9999);
    const bx = this.scale.width - MINIMAP_SIZE - MINIMAP_PADDING;
    const by = MINIMAP_TOP;
    // Outer border (wall color)
    borderGfx.lineStyle(3, 0x4a4a5e, 1);
    borderGfx.strokeRect(bx - 2, by - 2, MINIMAP_SIZE + 4, MINIMAP_SIZE + 4);
    // Inner highlight (floor color, subtle)
    borderGfx.lineStyle(1, 0x6a6a7e, 0.6);
    borderGfx.strokeRect(bx - 0.5, by - 0.5, MINIMAP_SIZE + 1, MINIMAP_SIZE + 1);
    // Corner accents (small squares at corners)
    const cs = 4;
    borderGfx.fillStyle(0x6b4226, 0.8);
    borderGfx.fillRect(bx - 3, by - 3, cs, cs);
    borderGfx.fillRect(bx + MINIMAP_SIZE - 1, by - 3, cs, cs);
    borderGfx.fillRect(bx - 3, by + MINIMAP_SIZE - 1, cs, cs);
    borderGfx.fillRect(bx + MINIMAP_SIZE - 1, by + MINIMAP_SIZE - 1, cs, cs);
    this.minimapBorder = borderGfx;

    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setSize(gameSize.width, gameSize.height);
      this.applyMainCameraBounds(this.currentMapPixelWidth, this.currentMapPixelHeight);
      if (this.minimap) {
        this.minimap.setPosition(gameSize.width - MINIMAP_SIZE - MINIMAP_PADDING, MINIMAP_TOP);
      }
      // Redraw minimap border on resize
      if (this.minimapBorder) {
        this.minimapBorder.clear();
        const rx = gameSize.width - MINIMAP_SIZE - MINIMAP_PADDING;
        const ry = MINIMAP_TOP;
        this.minimapBorder.lineStyle(3, 0x4a4a5e, 1);
        this.minimapBorder.strokeRect(rx - 2, ry - 2, MINIMAP_SIZE + 4, MINIMAP_SIZE + 4);
        this.minimapBorder.lineStyle(1, 0x6a6a7e, 0.6);
        this.minimapBorder.strokeRect(rx - 0.5, ry - 0.5, MINIMAP_SIZE + 1, MINIMAP_SIZE + 1);
        this.minimapBorder.fillStyle(0x6b4226, 0.8);
        this.minimapBorder.fillRect(rx - 3, ry - 3, cs, cs);
        this.minimapBorder.fillRect(rx + MINIMAP_SIZE - 1, ry - 3, cs, cs);
        this.minimapBorder.fillRect(rx - 3, ry + MINIMAP_SIZE - 1, cs, cs);
        this.minimapBorder.fillRect(rx + MINIMAP_SIZE - 1, ry + MINIMAP_SIZE - 1, cs, cs);
      }
    });

    // Dialog events
    this.eventScope.on("dialog:open", () => {
      this.dialogOpen = true;
    });
    this.eventScope.on("dialog:close", () => {
      this.dialogOpen = false;
    });
    // 보이는 방이 바뀌면, 그 방이 아닌 호출된 NPC 는 타이머 없이 바로 자리로 간다.
    this.eventScope.on("room:visible", (data: { roomId: string | null }) => {
      this.visibleRoomId = data.roomId;
      for (const npc of this.npcSprites) {
        if (!shouldReturnOnRoomChange(npc, data.roomId)) continue;
        this.sendNpcHome(npc);
      }
    });

    // Placement mode events
    this.eventScope.on("placement-mode-start", (npc: { id: string }) => {
      this.placementNpcId = npc.id;
      this.placementMode = true;
    });
    this.eventScope.on("placement-mode-end", () => {
      this.placementMode = false;
      this.placementNpcId = null;
      this.placementHighlight?.destroy();
      this.placementHighlight = null;
    });

    // Spawn set mode events
    this.eventScope.on("spawn-set-mode-start", () => {
      this.spawnSetMode = true;
    });
    this.eventScope.on("spawn-set-mode-end", () => {
      this.spawnSetMode = false;
      this.spawnHighlight?.destroy();
      this.spawnHighlight = null;
    });
    this.eventScope.on("task-automation-updated", (data: { reportWaitSeconds?: number }) => {
      if (typeof data.reportWaitSeconds === "number") {
        this.reportWaitMs = Math.max(5000, data.reportWaitSeconds * 1000);
      }
    });
    this.eventScope.on("owner-status", (data: { isOwner: boolean }) => {
      this.isChannelOwner = data.isOwner;
    });

    // Local NPC spawn/remove (from own hire/fire actions)
    this.eventScope.on(
      "npc:spawn-local",
      (raw: {
        id: string;
        name: string;
        positionX: number;
        positionY: number;
        direction?: string;
        appearance?: unknown;
      }) => {
        const npcData: NpcData = { ...raw, direction: raw.direction || "down" };
        if (this.npcSprites.some((n) => n.id === npcData.id)) return;
        const npc = new NpcSprite(this, npcData);
        this.npcSprites.push(npc);
        this.restoreMotionNpc(npc);
        this.npcTilePositions.add(`${npcData.positionX},${npcData.positionY}`);
      },
    );
    this.eventScope.on("npc:remove-local", (data: { npcId: string }) => {
      this.removeNpcById(data.npcId);
    });
    this.eventScope.on(
      "npc:update-local",
      (data: { npcId: string; name?: string; direction?: string; appearance?: unknown }) => {
        const npc = this.npcSprites.find((n) => n.id === data.npcId);
        if (!npc) return;
        npc.updateFromData(data);
      },
    );

    this.eventScope.on("npc:movement-owner", (data: { npcId: string; ownerId: string }) => {
      this.takeNpcOwnership(data.npcId, data.ownerId);
    });

    this.eventScope.on(
      "npc:start-move",
      (data: { npcId: string; targetCol: number; targetRow: number; message?: string }) => {
        const npc = this.npcSprites.find((n) => n.id === data.npcId);
        if (!npc || !this.ensureLocalNpcOwnership(npc) || npc.moveState !== "idle") return;
        this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
        npc.moveTo(
          data.targetCol,
          data.targetRow,
          findPath,
          this.createNpcWalkValidator(),
          data.message ? { message: data.message } : undefined,
        );
      },
    );

    this.eventScope.on(
      "npc:call-to-player",
      (data: {
        npcId: string;
        message?: string;
        reportId?: string;
        reportKind?: string;
        bubbleText?: string;
        npcName?: string;
        reason?: string;
        roomId?: string;
      }) => {
        if (
          !this.player ||
          !this.motionSnapshot.current ||
          !this.npcSprites.some((npc) => npc.id === data.npcId)
        ) {
          this.pendingNpcCalls.set(data.npcId, data);
          return;
        }
        const playerCol = Math.floor(this.player.x / TILE_SIZE);
        const playerRow = Math.floor(this.player.y / TILE_SIZE);
        const npc = this.npcSprites.find((n) => n.id === data.npcId);
        if (!npc) return;
        if (!this.ensureLocalNpcOwnership(npc, data.reason, data.roomId)) return;
        if (npc.moveState !== "idle") return;
        npc.calledForRoom = data.reason === "map-chat" ? (data.roomId ?? null) : null;

        const dist = npc.distanceTo(this.player.x, this.player.y);
        if (dist < TILE_SIZE + 4) {
          npc.pendingMessage = data.message || null;
          npc.pendingReportId = data.reportId || null;
          npc.pendingReportKind = data.reportKind || null;
          npc.arrivalBubbleText = data.bubbleText || null;
          npc.waitDurationMs = data.reportKind === "complete" ? this.reportWaitMs : 10000;
          npc.moveState = "waiting";
          npc.waitTimer = 0;
          if (!npc.calledForRoom || npc.pendingReportId)
            EventBus.emit("npc:bubble", {
              npcId: npc.id,
              text: npc.arrivalBubbleText || undefined,
            });
          EventBus.emit("toast:show", {
            messageKey: "game.pressToTalk",
            params: { name: data.npcName || npc.name },
          });
          EventBus.emit("npc:movement-arrived", {
            npcId: npc.id,
            npcName: data.npcName || npc.name,
            pendingMessage: npc.pendingMessage,
            reportId: npc.pendingReportId,
            reportKind: npc.pendingReportKind,
          });
          publishNpcArrival((event, payload) => this.socket?.emit(event, payload), {
            channelId: this.channelId,
            npcId: npc.id,
            x: npc.pixelX,
            y: npc.pixelY,
            direction: DIR_NUM_TO_NAME[npc.direction],
          });
          return;
        }

        this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
        npc.moveTo(playerCol, playerRow, findPath, this.createNpcWalkValidator(), {
          message: data.message,
          reportId: data.reportId,
          reportKind: data.reportKind,
          bubbleText: data.bubbleText,
          waitDurationMs: data.reportKind === "complete" ? this.reportWaitMs : 10000,
        });
      },
    );

    // NPC finished responding — if far from player, walk to deliver the response
    this.eventScope.on("npc:deliver-response", (data: { npcId: string; npcName: string }) => {
      if (!this.player) return;
      const npc = this.npcSprites.find((n) => n.id === data.npcId);
      if (!npc) return;

      const dist = npc.distanceTo(this.player.x, this.player.y);
      if (dist < TILE_SIZE + 4) {
        // Already close — just show bubble
        EventBus.emit("npc:bubble", { npcId: npc.id });
        return;
      }

      // NPC is far — walk to player (only if idle)
      if (!this.ensureLocalNpcOwnership(npc) || npc.moveState !== "idle") return;
      this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
      const playerCol = Math.floor(this.player.x / TILE_SIZE);
      const playerRow = Math.floor(this.player.y / TILE_SIZE);
      npc.moveTo(playerCol, playerRow, findPath, this.createNpcWalkValidator(), {
        message: `${data.npcName}이(가) 대화를 원합니다`,
      });
    });

    this.eventScope.on("npc:start-return", (data: { npcId: string }) => {
      if (!this.npcOwnership.startReturn(data.npcId)) return;
      const npc = this.npcSprites.find((n) => n.id === data.npcId);
      if (!npc || !this.mayDriveNpc(npc) || npc.moveState === "returning") return;
      npc.returnToHome(this.npcPathfinder(npc), this.createNpcWalkValidator());
      if (npc.moveState === "idle") this.finishNpcReturn(npc, true);
    });

    this.eventScope.on("npc:approach-and-interact", (data: { npcId: string; npcName?: string }) => {
      this.approachNpcAndInteract(data.npcId, data.npcName);
    });

    // ESC key handler
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.placementMode) {
        EventBus.emit("placement-cancel");
      }
      if (this.spawnSetMode) {
        EventBus.emit("spawn-set-cancel");
      }
    });

    // Disable browser context menu so right-click is available for game use
    this.input.mouse?.disableContextMenu();

    // NPC hover highlight
    let lastHoveredNpc: NpcSprite | null = null;
    let lastHoveredRemote: RemotePlayer | null = null;
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      // Update editor cursor position
      if (this.editorMode && this.editorCursor) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tileX = Math.floor(worldPoint.x / TILE_SIZE);
        const tileY = Math.floor(worldPoint.y / TILE_SIZE);
        this.editorCursor.clear();
        if (tileX >= 0 && tileX < MAP_COLS && tileY >= 0 && tileY < MAP_ROWS) {
          this.editorCursor.lineStyle(2, 0x00ff00, 0.8);
          this.editorCursor.strokeRect(tileX * TILE_SIZE, tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }

        // Object mode hover preview
        if (this.editorObjectMode) {
          if (tileX >= 0 && tileX < MAP_COLS && tileY >= 0 && tileY < MAP_ROWS) {
            const def = OBJECT_TYPES[this.selectedObjectType];
            if (def) {
              const texKey = `obj-${this.selectedObjectType}`;
              if (!this.editorObjectPreview) {
                this.editorObjectPreview = this.add.sprite(0, 0, texKey);
                this.editorObjectPreview.setOrigin(0.5, 1);
                this.editorObjectPreview.setAlpha(0.5);
                this.editorObjectPreview.setDepth(20020);
              } else if (this.editorObjectPreview.texture.key !== texKey) {
                this.editorObjectPreview.setTexture(texKey);
              }

              const w = def.width || 1;
              const h = def.height || 1;
              const x = (tileX + w / 2) * TILE_SIZE;
              const y = (tileY + h) * TILE_SIZE;
              this.editorObjectPreview.setPosition(x, y);
              this.editorObjectPreview.setVisible(true);

              const valid = canPlaceObject(
                this.selectedObjectType,
                tileX,
                tileY,
                this.mapObjects,
                this.wallsData,
              );
              this.editorObjectPreview.setTint(valid ? 0x44ff44 : 0xff4444);
            }
          } else {
            // Out of bounds — hide preview
            if (this.editorObjectPreview) {
              this.editorObjectPreview.setVisible(false);
            }
          }
        } else {
          // Not in object mode — hide preview if it exists
          if (this.editorObjectPreview) {
            this.editorObjectPreview.setVisible(false);
          }
        }
      }

      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      // Check NPC hover — use 1.5× tile radius because NPC sprite origin (0.5, 0.85)
      // places the visual top ~40 px above pixelY, so TILE_SIZE alone misses head clicks
      let hoveredNpc: NpcSprite | null = null;
      for (const npc of this.npcSprites) {
        if (
          matchesNpcTarget(
            { id: npc.id, x: npc.pixelX, y: npc.pixelY },
            { x: worldPoint.x, y: worldPoint.y, actorId: this.presentationActorId },
          )
        ) {
          hoveredNpc = npc;
          break;
        }
      }
      if (hoveredNpc !== lastHoveredNpc) {
        if (lastHoveredNpc) lastHoveredNpc.setHighlight(false);
        if (hoveredNpc) hoveredNpc.setHighlight(true);
        lastHoveredNpc = hoveredNpc;
      }

      // Check remote player hover
      let hoveredRemote: RemotePlayer | null = null;
      for (const remote of this.remotePlayers.values()) {
        if (remote.distanceTo(worldPoint.x, worldPoint.y) < TILE_SIZE) {
          hoveredRemote = remote;
          break;
        }
      }
      if (hoveredRemote !== lastHoveredRemote) {
        if (lastHoveredRemote) lastHoveredRemote.setHighlight(false);
        if (hoveredRemote) hoveredRemote.setHighlight(true);
        lastHoveredRemote = hoveredRemote;
      }

      if (this.game.canvas) {
        this.game.canvas.style.cursor = hoveredNpc || hoveredRemote ? "pointer" : "default";
      }
    });

    // Mouse click handler
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // Placement mode: place NPC on clicked tile
      if (this.placementMode) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const col = Math.floor(worldPoint.x / TILE_SIZE);
        const row = Math.floor(worldPoint.y / TILE_SIZE);
        if (this.canPlaceAt(col, row)) {
          EventBus.emit("placement-complete", { col, row });
        }
        return;
      }

      // Spawn set mode: set spawn point on clicked tile
      if (this.spawnSetMode) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const col = Math.floor(worldPoint.x / TILE_SIZE);
        const row = Math.floor(worldPoint.y / TILE_SIZE);
        if (this.isWalkable(col, row)) {
          EventBus.emit("spawn:selected", { col, row });
        }
        return;
      }

      // Editor mode: place/erase tiles or objects
      if (this.editorMode) {
        if (this.editorObjectMode) {
          const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const tileX = Math.floor(worldPoint.x / TILE_SIZE);
          const tileY = Math.floor(worldPoint.y / TILE_SIZE);

          if (pointer.rightButtonDown()) {
            // Right-click: delete object at tile
            const objIndex = this.mapObjects.findIndex((obj) => {
              const def = OBJECT_TYPES[obj.type];
              const w = def?.width || 1;
              const h = def?.height || 1;
              return (
                tileX >= obj.col && tileX < obj.col + w && tileY >= obj.row && tileY < obj.row + h
              );
            });
            if (objIndex >= 0) {
              const removed = this.mapObjects.splice(objIndex, 1)[0];
              this.renderObjects();
              this.socket?.emit("map:object-remove", { objectId: removed.id });
            }
          } else {
            // Left-click: place object
            if (
              canPlaceObject(this.selectedObjectType, tileX, tileY, this.mapObjects, this.wallsData)
            ) {
              const obj: MapObject = {
                id: generateObjectId(),
                type: this.selectedObjectType,
                col: tileX,
                row: tileY,
              };
              this.mapObjects.push(obj);
              this.renderObjects();
              this.socket?.emit("map:object-add", { object: obj });
            }
          }
          return;
        }
        this.handleEditorClick(pointer);
        return;
      }

      if (!this.player || !this.playerReady || !this.canMovePlayer()) return;

      // Right-click on NPC: context menu
      if (pointer.rightButtonDown()) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        for (const npc of this.npcSprites) {
          if (
            matchesNpcTarget(
              { id: npc.id, x: npc.pixelX, y: npc.pixelY },
              { x: worldPoint.x, y: worldPoint.y, actorId: this.presentationActorId },
            )
          ) {
            EventBus.emit("npc:context-menu", {
              npcId: npc.id,
              npcName: npc.name,
              screenX: this.presentationPointer?.x ?? pointer.x,
              screenY: this.presentationPointer?.y ?? pointer.y,
              moveState: npc.moveState,
            });
            return;
          }
        }
        return;
      }

      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const worldX = worldPoint.x;
      const worldY = worldPoint.y;

      const targetTileX = Math.floor(worldX / TILE_SIZE);
      const targetTileY = Math.floor(worldY / TILE_SIZE);

      let clickedNpc: NpcSprite | null = null;
      for (const npc of this.npcSprites) {
        if (
          matchesNpcTarget(
            { id: npc.id, x: npc.pixelX, y: npc.pixelY },
            { x: worldX, y: worldY, actorId: this.presentationActorId },
          )
        ) {
          clickedNpc = npc;
          break;
        }
      }

      const startTileX = Math.floor(this.player.x / TILE_SIZE);
      const startTileY = Math.floor(this.player.y / TILE_SIZE);

      let destTileX = targetTileX;
      let destTileY = targetTileY;

      if (clickedNpc) {
        destTileX = Math.floor(clickedNpc.pixelX / TILE_SIZE);
        destTileY = Math.floor(clickedNpc.pixelY / TILE_SIZE);
        const neighbors = [
          [destTileX, destTileY + 1],
          [destTileX, destTileY - 1],
          [destTileX - 1, destTileY],
          [destTileX + 1, destTileY],
        ];
        const walkable = neighbors.find(
          ([x, y]) => this.isWalkable(x, y) && !this.isTileOccupied(x, y),
        );
        if (walkable) {
          destTileX = walkable[0];
          destTileY = walkable[1];
        }
      }

      if (!this.isWalkable(destTileX, destTileY) || this.isTileOccupied(destTileX, destTileY)) {
        const nearest = this.findNearestWalkableTile(destTileX, destTileY);
        if (!nearest) return;
        destTileX = nearest.x;
        destTileY = nearest.y;
      }

      const path = this.findPlayerPath(startTileX, startTileY, destTileX, destTileY);

      // 클릭 한 번이 무슨 뜻인지 여기서 정한다. 예전에는 "걸어가서 도착하면 대화"뿐이라
      // 이미 옆에 서 있으면 경로가 서지 않아 아무 일도 일어나지 않았다.
      const intent = decideNpcClick({
        pathLength: path?.length ?? 0,
        clickedNpcId: clickedNpc?.id ?? null,
      });

      // 도착 대기를 걸 때만 목표를 남긴다 — 그러지 않으면 다음 이동의 도착 시점에
      // 엉뚱한 NPC 대화가 열린다.
      this.targetNpcId = clickedNpc && shouldRememberTarget(intent) ? clickedNpc.id : null;

      if (intent === "interact-now" && clickedNpc) {
        EventBus.emit("npc:interact", { npcId: clickedNpc.id, npcName: clickedNpc.name });
        return;
      }

      if (path && path.length > 1) {
        this.spawnInputStarted = true;
        this.traffic.clear("player:local");
        this.currentPath = path;
        this.pathIndex = 1;
        this.pathStuckTimer = 0;
        this.pathLastDist = Infinity;
        this.drawPathLine(path);
      }
    });

    // Pre-fetch NPC positions before allowing player spawn, then load sprites
    this.prefetchNpcPositions().then((npcs) => {
      if (!this.sys.isActive()) return;
      this.loadNpcs(npcs);
    });

    // Listen for spritesheet texture from React (only process once)
    let playerTextureLoaded = false;
    this.eventScope.on("spritesheet-ready", (dataUrl: string) => {
      if (playerTextureLoaded) return;
      playerTextureLoaded = true;
      this.loadPlayerTexture(dataUrl);
    });

    // Listen for socket from React — may arrive before or after player spawn
    const handleSocketReady = (data: {
      socket: Socket;
      characterId: string;
      characterName: string;
      appearance: unknown;
    }) => {
      this.socket = data.socket;
      this.characterId = data.characterId;
      this.characterName = data.characterName;
      this.appearance = data.appearance;
      this.setupSocketListeners();

      if (this.playerReady && this.player) {
        this.joinMultiplayer(this.player.x, this.player.y);
      }
    };
    this.eventScope.on("socket-ready", handleSocketReady);

    this.responsePhases = {};
    this.eventScope.on(
      "npc:response-phases",
      (data: { phases: Record<string, "queued" | "thinking" | "streaming"> }) => {
        this.responsePhases = data.phases;
      },
    );
    // Conversation previews are independent of activity/greeting lifecycle.
    this.eventScope.on("chat:speech", (data: { actorId: string; text: string }) => {
      this.speechPreviews.set(data.actorId, data.text, this.time.now);
    });
    // Speech bubble listeners
    this.eventScope.on("chat:bubble", (data: { senderId: string }) => {
      this.showPlayerBubble(data.senderId);
    });
    this.eventScope.on(
      "npc:bubble",
      (data: { npcId: string; text?: string; durationMs?: number }) => {
        this.showNpcBubbleIcon(data.npcId, data.text, data.durationMs);
      },
    );
    this.eventScope.on("npc:bubble-clear", (data: { npcId: string }) => {
      this.clearNpcBubble(data.npcId);
      this.activityBubbles.delete(data.npcId);
    });
    // 작업 중 표시. "할 말 있음"(점 세 개) 말풍선과 자리는 같지만 뜻이 다르므로,
    // 활동으로 띄운 것만 따로 기억해 두었다가 활동이 끝날 때 그것만 지운다 —
    // 그러지 않으면 NPC 가 정말 할 말이 있어 띄운 말풍선까지 같이 사라진다.
    this.eventScope.on("npc:activity-bubble", (data: { npcId: string; text?: string }) => {
      if (data.text) {
        this.activityBubbles.add(data.npcId);
        this.showNpcBubbleIcon(data.npcId, data.text);
        return;
      }
      if (this.activityBubbles.delete(data.npcId)) {
        this.clearNpcBubble(data.npcId);
      }
    });

    // Respond to position requests from React (for save-on-leave)
    this.eventScope.on("request-player-position", () => {
      if (this.player) {
        EventBus.emit("player-position-response", { x: this.player.x, y: this.player.y });
      }
    });

    // Tell React the scene is ready
    EventBus.emit("scene-ready");
    EventBus.emit("three:bridge-ready", this.officeBridge);

    // Clean up GameScene's own EventBus listeners when this scene is destroyed.
    // This prevents stale listeners from accumulating across game recreations
    // (e.g. React Strict Mode double-invocation).
    const cleanupEvents = () => {
      this.eventScope.dispose();
      this.events.off("shutdown", cleanupEvents);
      this.events.off("destroy", cleanupEvents);
    };
    this.events.once("shutdown", cleanupEvents);
    this.events.once("destroy", cleanupEvents);

    // Also re-request socket in case it was already sent before we registered
    EventBus.emit("request-socket");
  }

  // ---------------------------------------------------------------------------
  // Tiled JSON map loading
  // ---------------------------------------------------------------------------

  private loadTiledMap(tiledJson: Record<string, unknown>): void {
    this.tiledMode = true;
    this.officeEnvironment = resolveOfficeEnvironment(tiledJson);
    this.ambientZones = readAmbientZones(tiledJson);
    // Resolve external tileset references — Phaser doesn't support them
    const tilesetArr = tiledJson.tilesets as Array<Record<string, unknown>>;
    if (tilesetArr) {
      for (let i = 0; i < tilesetArr.length; i++) {
        if (tilesetArr[i].source && !tilesetArr[i].image) {
          // Replace external reference with embedded DeskRPG default tileset
          const firstgid = tilesetArr[i].firstgid || 1;
          tilesetArr[i] = {
            firstgid,
            name: "deskrpg-tileset",
            tilewidth: 32,
            tileheight: 32,
            tilecount: 16,
            columns: 16,
            image: "deskrpg-tileset.png",
            imagewidth: 512,
            imageheight: 32,
          };
        }
      }
    }

    // Destroy existing layers if any
    if (this.floorLayer) {
      this.floorLayer.destroy();
      this.floorLayer = null;
    }
    if (this.wallsLayer) {
      this.wallsLayer.destroy();
      this.wallsLayer = null;
    }
    for (const s of this.foregroundTileSprites) s.destroy();
    this.foregroundTileSprites = [];

    // Add Tiled JSON to Phaser's tilemap cache
    this.cache.tilemap.add("channel-map", {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: tiledJson,
    });

    // Load custom tileset images before creating the tilemap
    const tilesetDefs =
      (tiledJson.tilesets as Array<{
        firstgid: number;
        source?: string;
        name?: string;
        image?: string;
        tilewidth?: number;
        tileheight?: number;
      }>) || [];

    const imagesToLoad: { key: string; url: string; tileWidth: number; tileHeight: number }[] = [];
    for (const ts of tilesetDefs) {
      const tsName = ts.name || ts.source?.replace(/\.tsx$/, "") || "deskrpg-tileset";
      const tsImage = ts.image || "";
      const tileW = ts.tilewidth || TILE_SIZE;
      const tileH = ts.tileheight || TILE_SIZE;

      // Skip if texture already loaded (e.g. "office-tiles" from BootScene)
      if (this.textures.exists(tsName)) continue;

      // Determine image URL
      if (tsImage.startsWith("data:")) {
        // Base64 data URL — load directly
        imagesToLoad.push({ key: tsName, url: tsImage, tileWidth: tileW, tileHeight: tileH });
      } else if (tsImage.startsWith("/")) {
        // Absolute path (e.g. /assets/uploads/{id}/tileset.png)
        imagesToLoad.push({ key: tsName, url: tsImage, tileWidth: tileW, tileHeight: tileH });
      } else if (tsImage && tsImage !== "deskrpg-tileset.png") {
        // Relative path — try common locations
        imagesToLoad.push({
          key: tsName,
          url: `/assets/uploads/${tsImage}`,
          tileWidth: tileW,
          tileHeight: tileH,
        });
      }
    }

    if (imagesToLoad.length > 0) {
      // Dynamically load tileset images, then continue
      for (const img of imagesToLoad) {
        this.load.image(img.key, img.url);
      }
      this.load.once("complete", () => {
        this.finishTiledMapLoad(tiledJson, imagesToLoad);
      });
      this.load.once("loaderror", (file: { key: string; url: string }) => {
        console.error("[GameScene] Failed to load tileset image:", file.key, file.url);
      });
      this.load.start();
      return;
    }

    // No custom images to load — proceed immediately
    this.finishTiledMapLoad(tiledJson, []);
  }

  private finishTiledMapLoad(
    tiledJson: Record<string, unknown>,
    _loadedImages: { key: string; tileWidth: number; tileHeight: number }[],
  ): void {
    const map = this.make.tilemap({ key: "channel-map" });

    // Add tilesets to the map
    const tilesetDefs =
      (tiledJson.tilesets as Array<{
        firstgid: number;
        source?: string;
        name?: string;
        image?: string;
        tilewidth?: number;
        tileheight?: number;
      }>) || [];

    for (const ts of tilesetDefs) {
      const tsName = ts.name || ts.source?.replace(/\.tsx$/, "") || "deskrpg-tileset";
      const tileW = ts.tilewidth || TILE_SIZE;
      const tileH = ts.tileheight || TILE_SIZE;

      if (this.textures.exists(tsName)) {
        // Custom loaded texture or BootScene texture
        map.addTilesetImage(tsName, tsName, tileW, tileH, 0, 0);
      } else if (
        this.textures.exists("office-tiles") &&
        (tsName === "deskrpg-tileset" || (ts.image || "").includes("deskrpg"))
      ) {
        // DeskRPG default tileset → use office-tiles
        map.addTilesetImage(tsName, "office-tiles", TILE_SIZE, TILE_SIZE, 0, 0);
      } else if (this.textures.exists("office-tiles")) {
        // Unknown tileset but office-tiles available — use as fallback
        console.warn(`[GameScene] Unknown tileset "${tsName}", using office-tiles fallback`);
        map.addTilesetImage(tsName, "office-tiles", TILE_SIZE, TILE_SIZE, 0, 0);
      }
    }

    // Ensure each tileset's texture has per-tile frame entries so foreground
    // tile sprites can reference individual frames via (texKey, localFrameIndex).
    for (const ts of tilesetDefs) {
      const tsName = ts.name || ts.source?.replace(/\.tsx$/, "") || "deskrpg-tileset";
      const phaserTs = map.getTileset(tsName);
      if (!phaserTs || !phaserTs.image) continue;
      const texture = phaserTs.image as Phaser.Textures.Texture;
      const cols = phaserTs.columns || 1;
      const total = phaserTs.total || 1;
      const tw = phaserTs.tileWidth;
      const th = phaserTs.tileHeight;
      for (let fi = 0; fi < total; fi++) {
        if (!texture.has(String(fi))) {
          const col = fi % cols;
          const row = Math.floor(fi / cols);
          texture.add(String(fi), 0, col * tw, row * th, tw, th);
        }
      }
    }

    // Create tile layers — try by name first, fallback to order
    const mapWidth = (tiledJson.width as number) || MAP_COLS;
    const mapHeight = (tiledJson.height as number) || MAP_ROWS;

    // Set effective map dimensions for isWalkable bounds check
    this.effectiveMapCols = mapWidth;
    this.effectiveMapRows = mapHeight;

    // Update physics/camera bounds to actual Tiled map size
    const tiledPixelW = mapWidth * TILE_SIZE;
    const tiledPixelH = mapHeight * TILE_SIZE;
    this.applyMainCameraBounds(tiledPixelW, tiledPixelH);
    // Extract collision layer data for walkability checks
    this.collisionData = [];
    const tiledLayersRaw =
      (tiledJson.layers as Array<{
        name: string;
        type: string;
        data?: number[];
        width?: number;
      }>) || [];
    const collisionLayerData = tiledLayersRaw.find(
      (l) => l.type === "tilelayer" && l.name.toLowerCase() === "collision",
    );
    if (collisionLayerData?.data) {
      const w = collisionLayerData.width || mapWidth;
      for (let r = 0; r < mapHeight; r++) {
        this.collisionData.push(collisionLayerData.data.slice(r * w, (r + 1) * w));
      }
    }

    // Get all tile layer names from the Tiled JSON
    const tiledLayers = (tiledJson.layers as Array<{ name: string; type: string }>) || [];
    const tileLayerNames = tiledLayers.filter((l) => l.type === "tilelayer").map((l) => l.name);

    // Try named layers first, fallback to first/second tile layer by order
    const floorLayerName =
      tileLayerNames.find((n) => n.toLowerCase() === "floor") || tileLayerNames[0];
    const wallsLayerName =
      tileLayerNames.find((n) => n.toLowerCase() === "walls") || tileLayerNames[1];

    let floorLayer: Phaser.Tilemaps.TilemapLayer | null = null;
    if (floorLayerName) {
      floorLayer = map.createLayer(floorLayerName, map.tilesets);
      if (floorLayer) {
        floorLayer.setDepth(0);
        this.floorLayer = floorLayer;
      }
    }

    let wallsLayer: Phaser.Tilemaps.TilemapLayer | null = null;
    if (wallsLayerName && wallsLayerName !== floorLayerName) {
      wallsLayer = map.createLayer(wallsLayerName, map.tilesets);
      if (wallsLayer) {
        wallsLayer.setDepth(1);
        this.wallsLayer = wallsLayer;
        // Walls layer is decorative only — collision is handled by the Collision layer
      }
    }

    // Create any remaining tile layers (3rd, 4th, etc.)
    // Depth rules (matching map editor CHARACTER_DEPTH_THRESHOLD = 10000):
    //   "collision"   → semi-transparent debug overlay (depth 9999)
    //   depth >= 10000 (by name or "depth" property) → per-tile sprites for y-sort
    //   depth <  10000 → static TilemapLayer at assigned depth
    const allRawLayers = (tiledJson.layers as Array<Record<string, unknown>>) || [];

    /** Read the numeric `depth` property from a Tiled layer's properties array. */
    const getLayerDepthProp = (layerName: string, fallback: number): number => {
      const raw = allRawLayers.find((l) => l.name === layerName);
      if (!raw) return fallback;
      const props = raw.properties as
        Array<{ name: string; type: string; value: unknown }> | undefined;
      if (!props) return fallback;
      const dp = props.find((p) => p.name === "depth");
      if (!dp) return fallback;
      if (dp.type === "int" || dp.type === "float") return Number(dp.value) || fallback;
      if (dp.type === "string" && dp.value === "y-sort") return 5000;
      return fallback;
    };

    for (let i = 0; i < tileLayerNames.length; i++) {
      const name = tileLayerNames[i];
      if (name === floorLayerName || name === wallsLayerName) continue;
      const nameLower = name.toLowerCase();

      // Determine target depth
      let layerDepth: number;
      if (nameLower === "collision") {
        layerDepth = 9999;
      } else if (nameLower === "foreground" || nameLower === "above" || nameLower === "overlay") {
        layerDepth = getLayerDepthProp(name, 10000);
      } else {
        layerDepth = getLayerDepthProp(name, i + 2);
      }

      if (layerDepth >= 10000) {
        // Foreground layer: convert to individual sprites so every tile gets
        // its own depth (10000 + tile bottom pixel) — enabling per-tile y-sort
        // that matches the map editor's charAboveRow split-render logic.
        const tempLayer = map.createLayer(name, map.tilesets);
        if (tempLayer) {
          const layerAlpha = (allRawLayers.find((l) => l.name === name)?.opacity as number) ?? 1;
          tempLayer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
            if (tile.index < 0) return;
            const tileset = tile.tileset;
            if (!tileset || !tileset.image) return;
            const texKey = (tileset.image as Phaser.Textures.Texture).key;
            const localFrame = String(tile.index - tileset.firstgid);
            const px = tile.pixelX + tile.width / 2;
            const py = tile.pixelY + tile.height / 2;
            const sprite = this.add.sprite(px, py, texKey, localFrame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setAlpha(layerAlpha);
            if (tile.flipX) sprite.setFlipX(true);
            if (tile.flipY) sprite.setFlipY(true);
            // Depth = layerDepth base + bottom edge of tile row → y-sort with player
            sprite.setDepth(layerDepth + tile.pixelY + tile.height);
            this.foregroundTileSprites.push(sprite);
          });
          tempLayer.destroy();
        }
      } else {
        // Background layer: static TilemapLayer
        const extraLayer = map.createLayer(name, map.tilesets);
        if (extraLayer) {
          if (nameLower === "collision") {
            extraLayer.setAlpha(0.7);
            extraLayer.setDepth(9999);
          } else {
            extraLayer.setDepth(layerDepth);
          }
        }
      }
    }

    // Extract floor/walls data arrays for the legacy collision system
    // (isWalkable() checks floorData/wallsData directly)
    this.floorData = [];
    this.wallsData = [];
    for (let r = 0; r < mapHeight; r++) {
      const floorRow = new Array(mapWidth).fill(0);
      const wallsRow = new Array(mapWidth).fill(0);
      for (let c = 0; c < mapWidth; c++) {
        if (floorLayer) {
          const tile = floorLayer.getTileAt(c, r);
          floorRow[c] = tile ? tile.index : 0;
        }
        if (wallsLayer) {
          const tile = wallsLayer.getTileAt(c, r);
          wallsRow[c] = tile ? tile.index : 0;
        }
      }
      this.floorData.push(floorRow);
      this.wallsData.push(wallsRow);
    }

    // Process object layers + Collision layer
    this.mapObjects = [];
    const collisionCells = new Set<string>();
    const allLayers = tiledJson.layers as Array<Record<string, unknown>> | undefined;
    for (const layer of allLayers || []) {
      const layerName = ((layer.name as string) || "").toLowerCase();

      // --- Collision layer (objectgroup): all objects become collision rects ---
      if (layer.type === "objectgroup" && layerName === "collision") {
        const objects = layer.objects as Array<Record<string, unknown>> | undefined;
        for (const obj of objects || []) {
          const ox = (obj.x as number) || 0;
          const oy = (obj.y as number) || 0;
          const ow = (obj.width as number) || TILE_SIZE;
          const oh = (obj.height as number) || TILE_SIZE;
          // Convert pixel rect to tile cells
          const startCol = Math.floor(ox / TILE_SIZE);
          const startRow = Math.floor(oy / TILE_SIZE);
          const endCol = Math.ceil((ox + ow) / TILE_SIZE);
          const endRow = Math.ceil((oy + oh) / TILE_SIZE);
          for (let r = startRow; r < endRow; r++) {
            for (let c = startCol; c < endCol; c++) {
              collisionCells.add(`${c},${r}`);
            }
          }
        }
        continue; // Don't process collision layer as regular objects
      }

      // --- Collision layer (tilelayer): any non-zero tile is collision ---
      if (layer.type === "tilelayer" && layerName === "collision") {
        const data = layer.data as number[] | undefined;
        if (data) {
          for (let r = 0; r < mapHeight; r++) {
            for (let c = 0; c < mapWidth; c++) {
              const gid = data[r * mapWidth + c] || 0;
              if (gid !== 0) {
                collisionCells.add(`${c},${r}`);
              }
            }
          }
        }
        // Show collision tile layer with transparency
        const collisionTileLayer = map.getLayer(layer.name as string);
        if (collisionTileLayer?.tilemapLayer) {
          collisionTileLayer.tilemapLayer.setAlpha(0.7);
          collisionTileLayer.tilemapLayer.setDepth(9999);
        }
        continue;
      }

      // --- Regular object layers ---
      if (layer.type === "objectgroup") {
        const objects = layer.objects as Array<Record<string, unknown>> | undefined;
        for (const obj of objects || []) {
          // Spawn point — use Objects layer as fallback only if mapConfig hasn't set one
          if (obj.name === "spawn" || obj.type === "spawn") {
            if (this.mapConfigSpawnCol === null) {
              this.tiledSpawnCol = Math.floor((obj.x as number) / TILE_SIZE);
            }
            if (this.mapConfigSpawnRow === null) {
              this.tiledSpawnRow = Math.floor((obj.y as number) / TILE_SIZE);
            }
            continue;
          }

          // Furniture/object — only add if type is recognized
          const objectType = (obj.type as string) || "";
          if (objectType && OBJECT_TYPES[objectType]) {
            this.mapObjects.push({
              id: generateObjectId(),
              type: objectType,
              col: Math.floor((obj.x as number) / TILE_SIZE),
              row: Math.floor((obj.y as number) / TILE_SIZE),
              ...tiledDirection(
                obj.properties as Array<{ name: string; value: unknown }> | undefined,
              ),
              ...tiledVariant(
                obj.properties as Array<{ name: string; value: unknown }> | undefined,
              ),
            });
          }
        }
      }
    }

    this.renderObjects();
    this.objectOccupiedTiles = computeOccupiedTiles(this.mapObjects);
    // Merge collision layer cells into objectOccupiedTiles
    for (const cell of collisionCells) {
      this.objectOccupiedTiles.add(cell);
    }
  }

  // ---------------------------------------------------------------------------
  // Tilemap creation
  // ---------------------------------------------------------------------------

  private createTilemap(): void {
    // Destroy existing layers if any
    if (this.floorLayer) {
      this.floorLayer.destroy();
      this.floorLayer = null;
    }
    if (this.wallsLayer) {
      this.wallsLayer.destroy();
      this.wallsLayer = null;
    }

    // Floor layer
    const floorMap = this.make.tilemap({
      data: this.floorData,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const floorTileset = floorMap.addTilesetImage(
      "office-tiles",
      "office-tiles",
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
    );
    if (floorTileset) {
      this.floorLayer = floorMap.createLayer(0, floorTileset, 0, 0);
      if (this.floorLayer) {
        this.floorLayer.setDepth(0);
      }
    }

    // Walls layer
    const wallsMap = this.make.tilemap({
      data: this.wallsData,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const wallsTileset = wallsMap.addTilesetImage(
      "office-tiles",
      "office-tiles",
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
    );
    if (wallsTileset) {
      this.wallsLayer = wallsMap.createLayer(0, wallsTileset, 0, 0);
      if (this.wallsLayer) {
        this.wallsLayer.setDepth(1);
      }
    }
  }

  private renderObjects(): void {
    // Destroy existing sprites
    for (const sprite of this.objectSprites.values()) {
      sprite.destroy();
    }
    this.objectSprites.clear();
    this.ySortObjectSprites.clear();

    for (const obj of this.mapObjects) {
      const def = OBJECT_TYPES[obj.type];
      if (!def) continue;
      const dir = obj.direction || "down";
      let texKey = `obj-${obj.type}-${dir}`;
      if (!this.textures.exists(texKey)) {
        texKey = `obj-${obj.type}`; // fallback
      }
      if (!this.textures.exists(texKey)) continue;

      const { width: w, height: h } = getObjectDimensions(obj.type, obj.direction);
      const x = (obj.col + w / 2) * TILE_SIZE;
      const y = (obj.row + h) * TILE_SIZE;

      const sprite = this.add.sprite(x, y, texKey);
      sprite.setOrigin(0.5, 1);

      if (def.depthMode === "fixed") {
        sprite.setDepth(def.fixedDepth ?? 5);
      } else {
        this.ySortObjectSprites.set(obj.id, sprite);
      }

      this.objectSprites.set(obj.id, sprite);
    }

    this.objectOccupiedTiles = computeOccupiedTiles(this.mapObjects);
  }

  // ---------------------------------------------------------------------------
  // Map Editor
  // ---------------------------------------------------------------------------

  private toggleEditor(): void {
    this.editorMode = !this.editorMode;

    if (this.editorMode) {
      this.showEditor();
    } else {
      this.hideEditor();
    }
  }

  private showEditor(): void {
    const cam = this.cameras.main;

    // Grid overlay
    if (!this.gridOverlay) {
      this.gridOverlay = this.add.graphics();
      this.gridOverlay.setDepth(20020);
    }
    this.drawGrid();

    // Editor cursor (follows mouse)
    if (!this.editorCursor) {
      this.editorCursor = this.add.graphics();
      this.editorCursor.setDepth(20020);
    }

    // Toolbar container (fixed to camera via scrollFactor)
    if (!this.editorToolbar) {
      this.editorToolbar = this.add.container(0, 0);
      this.editorToolbar.setDepth(20020);
      this.editorToolbar.setScrollFactor(0);

      this.buildToolbar();
    }
    this.editorToolbar.setVisible(true);

    // Layer indicator
    if (!this.editorLayerText) {
      this.editorLayerText = this.add.text(10, 10, "", {
        fontSize: "12px",
        color: "#00ff00",
        stroke: "#000000",
        strokeThickness: 3,
        backgroundColor: "#000000aa",
        padding: { x: 6, y: 4 },
      });
      this.editorLayerText.setDepth(20020);
      this.editorLayerText.setScrollFactor(0);
    }
    this.updateLayerText();
    this.editorLayerText.setVisible(true);

    // Status text
    const statusText = this.add.text(
      10,
      35,
      "Editor Mode | LMB: place | RMB: erase | 1/2/3: layer | Tab: exit",
      {
        fontSize: "10px",
        color: "#aaaaaa",
        stroke: "#000000",
        strokeThickness: 2,
        backgroundColor: "#000000aa",
        padding: { x: 4, y: 2 },
      },
    );
    statusText.setDepth(20020);
    statusText.setScrollFactor(0);
    statusText.setName("editor-status");

    // "Save" button
    const saveBtn = this.add.text(cam.width / 2, cam.height / 2 - 60, "[ SAVE MAP ]", {
      fontSize: "14px",
      color: "#00ff00",
      stroke: "#000000",
      strokeThickness: 3,
      backgroundColor: "#333333",
      padding: { x: 10, y: 6 },
    });
    saveBtn.setOrigin(0.5);
    saveBtn.setDepth(20020);
    saveBtn.setScrollFactor(0);
    saveBtn.setInteractive({ useHandCursor: true });
    saveBtn.setName("editor-save-btn");
    saveBtn.setPosition(cam.width / 2, 12);
    saveBtn.on("pointerdown", () => {
      this.saveMap();
    });
    saveBtn.on("pointerover", () => {
      saveBtn.setStyle({ color: "#44ff44" });
    });
    saveBtn.on("pointerout", () => {
      saveBtn.setStyle({ color: "#00ff00" });
    });
  }

  private hideEditor(): void {
    if (this.gridOverlay) {
      this.gridOverlay.clear();
    }
    if (this.editorCursor) {
      this.editorCursor.clear();
    }
    if (this.editorToolbar) {
      this.editorToolbar.setVisible(false);
    }
    if (this.editorLayerText) {
      this.editorLayerText.setVisible(false);
    }
    // Destroy object preview and reset object mode
    if (this.editorObjectPreview) {
      this.editorObjectPreview.destroy();
      this.editorObjectPreview = null;
    }
    this.editorObjectMode = false;
    // Remove status text and save button
    const status = this.children.getByName("editor-status");
    if (status) status.destroy();
    const saveBtn = this.children.getByName("editor-save-btn");
    if (saveBtn) saveBtn.destroy();
  }

  private drawGrid(): void {
    if (!this.gridOverlay) return;
    this.gridOverlay.clear();

    this.gridOverlay.lineStyle(1, 0xffffff, 0.15);
    for (let c = 0; c <= MAP_COLS; c++) {
      this.gridOverlay.lineBetween(c * TILE_SIZE, 0, c * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    }
    for (let r = 0; r <= MAP_ROWS; r++) {
      this.gridOverlay.lineBetween(0, r * TILE_SIZE, MAP_COLS * TILE_SIZE, r * TILE_SIZE);
    }
  }

  private buildToolbar(): void {
    if (!this.editorToolbar) return;

    const cam = this.cameras.main;
    const tileCount = 16;
    const btnSize = 28;
    const gap = 4;
    const totalWidth = tileCount * (btnSize + gap);
    const startX = (cam.width / cam.zoom - totalWidth) / 2;
    const y = cam.height / cam.zoom - btnSize - 12;

    // Background bar
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRoundedRect(startX - 8, y - 8, totalWidth + 16, btnSize + 30, 6);
    this.editorToolbar.add(bg);

    // Selected tile highlight
    this.editorSelectedHighlight = this.add.graphics();
    this.editorToolbar.add(this.editorSelectedHighlight);

    for (let i = 0; i < tileCount; i++) {
      const bx = startX + i * (btnSize + gap);

      // Tile preview (small copy from the texture)
      const tileImg = this.add.image(bx + btnSize / 2, y + btnSize / 2, "office-tiles");
      tileImg.setCrop(i * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
      tileImg.setDisplaySize(btnSize, btnSize);
      tileImg.setOrigin(0.5, 0.5);
      this.editorToolbar.add(tileImg);

      // Label
      const label = this.add.text(bx + btnSize / 2, y + btnSize + 2, `${i}`, {
        fontSize: "7px",
        color: "#aaaaaa",
        align: "center",
      });
      label.setOrigin(0.5, 0);
      this.editorToolbar.add(label);

      // Invisible interactive zone
      const zone = this.add.zone(bx + btnSize / 2, y + btnSize / 2, btnSize, btnSize);
      zone.setInteractive({ useHandCursor: true });
      zone.on("pointerdown", () => {
        this.selectedTile = i;
        this.updateToolbarHighlight();
      });
      this.editorToolbar.add(zone);
    }

    this.updateToolbarHighlight();
  }

  private updateToolbarHighlight(): void {
    if (!this.editorSelectedHighlight || !this.editorToolbar) return;

    const cam = this.cameras.main;
    const tileCount = 16;
    const btnSize = 28;
    const gap = 4;
    const totalWidth = tileCount * (btnSize + gap);
    const startX = (cam.width / cam.zoom - totalWidth) / 2;
    const y = cam.height / cam.zoom - btnSize - 12;

    const bx = startX + this.selectedTile * (btnSize + gap);

    this.editorSelectedHighlight.clear();
    this.editorSelectedHighlight.lineStyle(2, 0x00ff00, 1);
    this.editorSelectedHighlight.strokeRect(bx - 1, y - 1, btnSize + 2, btnSize + 2);
  }

  private updateLayerText(): void {
    if (!this.editorLayerText) return;
    if (this.editorObjectMode) {
      const typeIndex = OBJECT_TYPE_LIST.findIndex((t) => t.id === this.selectedObjectType);
      const indexLabel = typeIndex >= 0 ? ` (${typeIndex + 1})` : "";
      this.editorLayerText.setText(
        `Object Mode: ${this.selectedObjectType}${indexLabel} | O: toggle mode`,
      );
    } else {
      const layerNames = ["Floor (1)", "Walls (2)"];
      this.editorLayerText.setText(
        `Layer: ${layerNames[this.selectedLayer] ?? "Unknown"} | Tile: ${TILE_NAMES[this.selectedTile]} | O: object mode`,
      );
    }
  }

  private handleEditorClick(pointer: Phaser.Input.Pointer): void {
    if (this.tiledMode) return; // Legacy tile editor not supported for Tiled JSON maps
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);

    if (tileX < 0 || tileX >= MAP_COLS || tileY < 0 || tileY >= MAP_ROWS) return;

    // Right-click: erase (set to empty or floor depending on layer)
    let layerName: string;
    let tileId: number;
    if (pointer.rightButtonDown()) {
      if (this.selectedLayer === 0) {
        this.floorData[tileY][tileX] = T.FLOOR;
        layerName = "floor";
        tileId = T.FLOOR;
      } else {
        this.wallsData[tileY][tileX] = T.EMPTY;
        layerName = "walls";
        tileId = T.EMPTY;
      }
    } else {
      // Left-click: place selected tile
      if (this.selectedLayer === 0) {
        this.floorData[tileY][tileX] = this.selectedTile;
        layerName = "floor";
        tileId = this.selectedTile;
      } else {
        this.wallsData[tileY][tileX] = this.selectedTile;
        layerName = "walls";
        tileId = this.selectedTile;
      }
    }

    // Recreate the tilemap to reflect changes
    this.createTilemap();

    // Broadcast tile change to other players in the channel
    this.socket?.emit("map:tiles-update", { layer: layerName, row: tileY, col: tileX, tileId });
  }

  private saveMap(): Promise<boolean> {
    const mapData: MapData = {
      layers: {
        floor: this.floorData,
        walls: this.wallsData,
      },
      objects: this.mapObjects,
    };

    // Save to localStorage (may fail in restricted contexts)
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("deskrpg-map-office", JSON.stringify(mapData));
      }
    } catch {
      // Storage access denied — skip
    }

    // Save to server (channel API if available, otherwise legacy maps API)
    const saveUrl = this.channelId ? `/api/channels/${this.channelId}` : "/api/maps/office";
    const saveMethod = this.channelId ? "PUT" : "POST";
    const saveBody = this.channelId ? { mapData } : { mapId: "office", layers: mapData };
    return fetch(saveUrl, {
      method: saveMethod,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saveBody),
    })
      .then((res) => {
        if (res.ok) {
          this.socket?.emit("map:layout-saved");
          // Flash the save button green
          const saveBtn = this.children.getByName(
            "editor-save-btn",
          ) as Phaser.GameObjects.Text | null;
          if (saveBtn) {
            saveBtn.setText("[ SAVED! ]");
            this.time.delayedCall(1500, () => {
              if (saveBtn.active) saveBtn.setText("[ SAVE MAP ]");
            });
          }
          return true;
        } else {
          console.error("[MapEditor] Server save failed:", res.status);
          return false;
        }
      })
      .catch((err) => {
        console.error("[MapEditor] Server save error:", err);
        return false;
      });
  }

  // ---------------------------------------------------------------------------
  // Load NPCs
  // ---------------------------------------------------------------------------

  /** Fetch NPC positions early so spawn collision check works before sprites load */
  private async prefetchNpcPositions(): Promise<NpcData[]> {
    // 실패는 빈 목록과 구분해서 알린다. 예전에는 채널 없이 `/api/npcs` 를 부르고
    // (씬 재시작이면 this.channelId 가 "" 다) 응답 상태를 보지 않아, 400 이 조용히
    // "NPC 0명" 으로 그려졌다.
    const result = await fetchChannelNpcs(this.channelId);
    if (!result.ok) {
      console.warn(`[GameScene] prefetchNpcPositions failed (${result.reason}):`, result.message);
      return [];
    }
    const npcs = result.npcs as NpcData[];
    for (const npc of npcs) {
      this.npcTilePositions.add(`${npc.positionX},${npc.positionY}`);
    }
    return npcs;
  }

  private loadNpcs(npcDataList: NpcData[]): void {
    for (const npc of npcDataList) {
      this.npcTilePositions.add(`${npc.positionX},${npc.positionY}`);
      const npcSprite = new NpcSprite(this, npc);
      this.npcSprites.push(npcSprite);
      this.restoreMotionNpc(npcSprite);
    }
  }

  private removeNpcById(npcId: string): void {
    this.npcOwnership.clear(npcId);
    const idx = this.npcSprites.findIndex((n) => n.id === npcId);
    if (idx === -1) return;
    const npc = this.npcSprites[idx];
    const col = Math.floor(npc.pixelX / TILE_SIZE);
    const row = Math.floor(npc.pixelY / TILE_SIZE);
    this.npcTilePositions.delete(`${col},${row}`);
    npc.destroy();
    this.npcSprites.splice(idx, 1);
    // 말풍선은 스프라이트의 자식이 아니라 씬 레벨 맵에 npcId 로 들어 있다. 여기서
    // 지우지 않으면 update() 가 "스프라이트가 없으니 위치만 갱신 안 함" 으로 넘어가
    // 컨테이너가 마지막 좌표에 영구히 남는다 — 퇴근에도, npc:removed 에도 같다.
    this.clearNpcBubble(npcId);
    this.activityBubbles.delete(npcId);
  }

  // ---------------------------------------------------------------------------
  // Socket.io listeners
  // ---------------------------------------------------------------------------

  private setupSocketListeners(): void {
    if (!this.socket) return;
    this.socketListenerCleanup?.();
    const socket = this.socket;
    const cleanup: (() => void)[] = [];
    const listen = <Args extends unknown[]>(event: string, listener: (...args: Args) => void) => {
      socket.on(event, listener);
      cleanup.push(() => socket.off(event, listener));
    };
    const dispose = () => {
      for (const off of cleanup) off();
    };
    this.socketListenerCleanup = dispose;
    this.eventScope.addCleanup(dispose);

    // 재연결 = 새 socket.id. 서버 players 맵에 없으므로 다시 join 한다.
    // (docs/BACKLOG.md "소켓이 재연결되면 채널 채팅·NPC 지명이 조용히 죽는다")
    //
    // setupSocketListeners() 는 정상 흐름에서 두 번 불린다 — create() 의 request-socket →
    // socket-ready 1차, spawnPlayer() 의 player-spawned → PhaserGame.tsx 가 같은 소켓으로
    // socket-ready 를 재발행하는 2차. off-then-on 으로 멱등하게 만들어, 재조인 1회에
    // player:join 이 두 번 나가지 않게 한다 (핸들러는 인스턴스 필드라 참조가 안정적이다).
    this.socket.off("disconnect", this.handleSocketDisconnect);
    listen("disconnect", this.handleSocketDisconnect);
    this.socket.off("connect", this.handleSocketConnect);
    listen("connect", this.handleSocketConnect);
    registerOnce(EventBus, "socket-rejoin", this.handleSocketRejoin);
    const cleanupSocketRejoinListener = () => {
      EventBus.off("socket-rejoin", this.handleSocketRejoin);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupSocketRejoinListener);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanupSocketRejoinListener);

    listen("npc:motion-state", (snapshot: MotionSnapshot) => {
      const first = !this.motionSnapshot.current;
      const becameLeader =
        this.motionSnapshot.current?.ambientLeaderId !== this.socket?.id &&
        snapshot.ambientLeaderId === this.socket?.id;
      if (!this.motionSnapshot.accept(snapshot, this.channelId)) return;
      const ownSeat = snapshot.seats.find((seat) => seat.actorId === this.socket?.id);
      if (first && ownSeat) this.playerSeatGoal = ownSeat.seatId;
      if (
        this.playerSeatGoal &&
        !snapshot.seats.some(
          (seat) => seat.seatId === this.playerSeatGoal && seat.actorId === this.socket?.id,
        )
      )
        this.playerSeatGoal = null;
      this.resumePlayerGoal();
      for (const npc of this.npcSprites) {
        const state = snapshot.npcs.find((entry) => entry.npcId === npc.id);
        if (state) this.applyMotionNpc(npc, state, restoreOnSnapshot(first, becameLeader, state));
        const pending = this.pendingNpcCalls.get(npc.id);
        if (pending && this.player) {
          this.pendingNpcCalls.delete(npc.id);
          EventBus.emit("npc:call-to-player", pending);
        }
      }
    });
    listen("player:spawn", (position: PlayerSpawnState) => {
      if (this.player && untouchedSpawn(this.spawnRequest, this.player, this.spawnInputStarted)) {
        this.player.setPosition(position.x, position.y);
        this.currentDirection = DIR_NAME_MAP[position.direction ?? "down"] ?? DIR_DOWN;
        this.player.anims.stop();
        this.player.setFrame(this.currentDirection * SPRITE_COLS);
        this.playerActuallyWalking = false;
        this.playerNameLabel?.setPosition(position.x, position.y - 44);
        this.currentPath = null;
        this.traffic.clear("player:local");
        // A remembered seat is an intention, never proof of a live reservation.
        this.playerSeatGoal = null;
        this.pendingPlayerResume = position.motion ?? null;
      }
      // Only after consuming the authoritative snapshot may local frames publish movement.
      this.spawnRequest = null;
      this.playerSpawnReady = true;
      this.lastSentMotion = "";
      this.resumePlayerGoal();
    });
    listen("players:state", (data: { players: RemotePlayerData[] }) => {
      this.peerMotionSamples = new Map(
        data.players.map((player) => [
          player.id,
          {
            receivedAt: performance.now(),
            moving: player.animation === "walk",
          },
        ]),
      );
      this.peerSnapshotReady = true;
      this.connectedPlayerIds = new Set(data.players.map((player) => player.id));
      this.peerPositions = new Map(
        data.players.map((player) => [
          player.id,
          { x: player.x, y: player.y, direction: player.direction, animation: player.animation },
        ]),
      );
      for (const [id, remote] of this.remotePlayers) {
        if (!this.connectedPlayerIds.has(id)) {
          remote.destroy();
          this.remotePlayers.delete(id);
        }
      }
      this.resumePlayerGoal();
      for (const p of data.players) {
        const remote = this.remotePlayers.get(p.id);
        if (remote) remote.updatePosition(p.x, p.y, p.direction, p.animation);
        else this.addRemotePlayer(p);
      }
    });

    listen("player:joined", (data: RemotePlayerData) => {
      this.peerMotionSamples.set(data.id, {
        receivedAt: performance.now(),
        moving: data.animation === "walk",
      });
      this.connectedPlayerIds.add(data.id);
      this.peerPositions.set(data.id, {
        x: data.x,
        y: data.y,
        direction: data.direction,
        animation: data.animation,
      });
      this.addRemotePlayer(data);
    });

    listen(
      "player:moved",
      (data: { id: string; x: number; y: number; direction: string; animation: string }) => {
        this.peerMotionSamples.set(data.id, {
          receivedAt: performance.now(),
          moving: data.animation === "walk",
        });
        this.peerPositions.set(data.id, {
          x: data.x,
          y: data.y,
          direction: data.direction,
          animation: data.animation,
        });
        const remote = this.remotePlayers.get(data.id);
        if (remote) {
          remote.updatePosition(data.x, data.y, data.direction, data.animation);
        }
      },
    );

    listen("player:left", (data: { id: string }) => {
      this.connectedPlayerIds.delete(data.id);
      this.peerPositions.delete(data.id);
      this.peerMotionSamples.delete(data.id);
      this.releaseNpcOwner(data.id);
      const remote = this.remotePlayers.get(data.id);
      if (remote) {
        remote.destroy();
        this.remotePlayers.delete(data.id);
      }
    });

    // NPC real-time sync
    listen("npc:added", (npcData: NpcData) => {
      if (this.npcSprites.some((n) => n.id === npcData.id)) return;
      const npc = new NpcSprite(this, npcData);
      this.npcSprites.push(npc);
      this.restoreMotionNpc(npc);
      this.npcTilePositions.add(`${npcData.positionX},${npcData.positionY}`);
    });

    // 두 가지 모양이 온다 — 옛 `{ npcId, … }`(외형·방향 편집)와 새 `{ npc }`(출근부
    // 토글). 판단은 `decideNpcUpdate` 가 한다(node 에서 테스트되는 순수 함수).
    listen("npc:updated", (data: NpcUpdatedPayload) => {
      const action = decideNpcUpdate(data, (id) => this.npcSprites.some((n) => n.id === id));
      if (action.kind === "ignore") return;
      if (action.kind === "remove") {
        this.removeNpcById(action.npcId);
        return;
      }
      if (action.kind === "update") {
        const npc = this.npcSprites.find((n) => n.id === action.npcId);
        if (!npc) return;
        npc.updateFromData(action.fields);
        return;
      }
      const npcData: NpcData = { ...action.npc };
      const npc = new NpcSprite(this, npcData);
      this.npcSprites.push(npc);
      this.restoreMotionNpc(npc);
      this.npcTilePositions.add(`${npcData.positionX},${npcData.positionY}`);
    });

    listen("npc:removed", (data: { npcId: string }) => {
      this.removeNpcById(data.npcId);
    });

    // Map editing real-time sync
    listen("map:object-added", (data: { object: MapObject }) => {
      this.mapObjects.push(data.object);
      this.renderObjects();
    });

    listen("map:object-removed", (data: { objectId: string }) => {
      this.mapObjects = this.mapObjects.filter((o) => o.id !== data.objectId);
      this.renderObjects();
    });

    listen(
      "map:tiles-updated",
      (data: { layer: string; row: number; col: number; tileId: number }) => {
        if (this.tiledMode) return; // Tiled JSON maps don't use legacy tile editing
        if (data.layer === "floor" && this.floorData[data.row]) {
          this.floorData[data.row][data.col] = data.tileId;
        } else if (data.layer === "walls" && this.wallsData[data.row]) {
          this.wallsData[data.row][data.col] = data.tileId;
        }
        this.createTilemap();
      },
    );

    listen("npc:stop-moving", (data: { npcId: string }) => {
      const npc = this.npcSprites.find((n) => n.id === data.npcId);
      if (!npc) return;
      npc.remoteWalkingUntil = 0;
      this.finishNpcReturn(npc, false);
      if (npc.sprite instanceof Phaser.GameObjects.Sprite) {
        npc.sprite.stop();
        const idleFrame = npc.direction * SPRITE_COLS;
        npc.sprite.setFrame(idleFrame);
      }
    });

    listen(
      "npc:position-sync",
      (data: { npcId: string; x: number; y: number; direction: string }) => {
        const npc = this.npcSprites.find((n) => n.id === data.npcId);
        // Modern snapshots already carry this update and its moving flag. A duplicate
        // legacy packet must not snap presentation or clear walking on equal coordinates.
        if (
          !npc ||
          this.motionSnapshot.current?.npcs.some((entry) => entry.npcId === data.npcId) ||
          this.mayDriveNpc(npc)
        )
          return;
        const moved = Math.hypot(npc.pixelX - data.x, npc.pixelY - data.y) > 0.01;
        npc.remoteWalkingUntil = moved ? this.time.now + 500 : 0;
        npc.pixelX = data.x;
        npc.pixelY = data.y;
        npc.direction = DIR_NAME_MAP[data.direction] ?? DIR_DOWN;
        npc.sprite.setPosition(data.x, data.y);
        npc.nameLabel.setPosition(data.x, data.y - 44);

        // Play walk animation matching direction (on other clients)
        if (npc.sprite instanceof Phaser.GameObjects.Sprite) {
          if (!moved) {
            npc.sprite.stop();
            npc.sprite.setFrame(npc.direction * SPRITE_COLS);
            return;
          }
          const walkKey = `npc-${npc.id}-walk-${data.direction}`;
          if (this.anims.exists(walkKey) && npc.sprite.anims.currentAnim?.key !== walkKey) {
            npc.sprite.play(walkKey, true);
          }
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Remote player management
  // ---------------------------------------------------------------------------

  private addRemotePlayer(data: RemotePlayerData): void {
    if (this.remotePlayers.has(data.id)) return;

    const textureKey = `remote-${data.id}`;
    const generation = this.motionGeneration;

    EventBus.emit("composite-remote-player", {
      id: data.id,
      appearance: data.appearance,
    });

    const handler = (result: { id: string; dataUrl: string }) => {
      if (result.id !== data.id) return;
      EventBus.off("remote-spritesheet-ready", handler);

      // Skip if this player was already added (duplicate event)
      if (this.remotePlayers.has(data.id)) return;

      const img = new window.Image();
      img.onload = () => {
        if (
          generation !== this.motionGeneration ||
          this.remotePlayers.has(data.id) ||
          !this.connectedPlayerIds.has(data.id) ||
          !this.sys.isActive()
        )
          return;
        if (!this.textures.exists(textureKey)) {
          this.textures.addSpriteSheet(textureKey, img, {
            frameWidth: 64,
            frameHeight: 64,
          });
        }
        this.createRemoteAnimations(textureKey);
        const remote = new RemotePlayer(
          this,
          { ...data, ...this.peerPositions.get(data.id) },
          textureKey,
        );
        this.remotePlayers.set(data.id, remote);
      };
      img.src = result.dataUrl;
    };

    this.eventScope.on("remote-spritesheet-ready", handler);
  }

  private createRemoteAnimations(textureKey: string): void {
    const directions = [
      { key: `${textureKey}-walk-up`, row: DIR_UP },
      { key: `${textureKey}-walk-left`, row: DIR_LEFT },
      { key: `${textureKey}-walk-down`, row: DIR_DOWN },
      { key: `${textureKey}-walk-right`, row: DIR_RIGHT },
    ];

    for (const dir of directions) {
      if (this.anims.exists(dir.key)) continue;
      this.anims.create({
        key: dir.key,
        frames: this.anims.generateFrameNumbers(textureKey, {
          start: dir.row * SPRITE_COLS + 1,
          end: dir.row * SPRITE_COLS + SPRITE_COLS - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Local player setup
  // ---------------------------------------------------------------------------

  private loadPlayerTexture(dataUrl: string): void {
    if (this.playerReady) return;

    const img = new Image();
    img.onerror = () => {
      if (!this.sys.isActive()) return;
      this.createPlayer(); // fallback texture will be used
    };
    img.onload = () => {
      if (!this.sys.isActive()) return;
      try {
        if (!this.textures.exists("player")) {
          this.textures.addSpriteSheet("player", img, {
            frameWidth: 64,
            frameHeight: 64,
          });
        }
      } catch {
        // texture add failed — createPlayer will use fallback
      }
      this.createPlayer();
    };
    img.src = dataUrl;
  }

  /** Check if a tile is occupied by an NPC, remote player, or known NPC position */
  private isTileOccupied(col: number, row: number): boolean {
    // Check pre-recorded NPC positions (available before sprites load)
    if (this.npcTilePositions.has(`${col},${row}`)) return true;

    return !clearActors(
      { x: col, y: row },
      { x: col, y: row },
      this.trafficActors().filter((actor) => actor.id !== "player:local"),
    );
  }

  /** Find a free walkable spawn position near the preferred tile */
  private findFreeSpawn(preferCol: number, preferRow: number): { col: number; row: number } {
    // Try the preferred position first
    if (this.isWalkable(preferCol, preferRow) && !this.isTileOccupied(preferCol, preferRow)) {
      return { col: preferCol, row: preferRow };
    }
    // Spiral outward to find a free tile
    for (let radius = 1; radius < Math.max(MAP_COLS, MAP_ROWS); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const c = preferCol + dx;
          const r = preferRow + dy;
          if (this.isWalkable(c, r) && !this.isTileOccupied(c, r)) {
            return { col: c, row: r };
          }
        }
      }
    }
    return { col: preferCol, row: preferRow }; // fallback
  }

  private createPlayer(): void {
    if (this.playerReady) return; // prevent double creation

    let spawnX: number;
    let spawnY: number;

    // Existing members resume where they left; configured spawn is for a fresh visit.
    if (this.savedPosition) {
      spawnX = this.savedPosition.x;
      spawnY = this.savedPosition.y;
      this.savedPosition = null;
    } else if (this.mapConfigSpawnCol !== null && this.mapConfigSpawnRow !== null) {
      const { col: spawnCol, row: spawnRow } = this.findFreeSpawn(
        this.mapConfigSpawnCol,
        this.mapConfigSpawnRow,
      );
      spawnX = spawnCol * TILE_SIZE + TILE_SIZE / 2;
      spawnY = spawnRow * TILE_SIZE + TILE_SIZE / 2;
      this.savedPosition = null;
    } else {
      // Find a free spawn position, checking NPCs, remote players, AND object occupied tiles
      const preferSpawnCol = this.tiledSpawnCol ?? 8;
      const preferSpawnRow = this.tiledSpawnRow ?? 3;
      const { col: spawnCol, row: spawnRow } = this.findFreeSpawn(preferSpawnCol, preferSpawnRow);
      spawnX = spawnCol * TILE_SIZE + TILE_SIZE / 2;
      spawnY = spawnRow * TILE_SIZE + TILE_SIZE / 2;
    }

    const playerTex = this.textures.exists("player") ? "player" : "fallback-char";
    this.player = this.physics.add.sprite(
      spawnX,
      spawnY,
      playerTex,
      playerTex === "player" ? DIR_DOWN * SPRITE_COLS : 0,
    );
    this.player.setOrigin(0.5, 0.85);
    this.player.setDisplaySize(48, 48);
    this.player.setSize(15, 12);
    this.player.setOffset(17, 32);
    this.player.setCollideWorldBounds(true);

    // Player name label (same style as remote players)
    this.playerNameLabel = this.add.text(spawnX, spawnY - 44, this.characterName, {
      fontSize: "11px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
      align: "center",
    });
    this.playerNameLabel.setOrigin(0.5, 1);
    this.playerNameLabel.setDepth(20001);

    this.createAnimations();
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.playerReady = true;
    EventBus.emit("player-spawned");

    this.joinMultiplayer(spawnX, spawnY);
  }

  private createAnimations(): void {
    const directions = [
      { key: "walk-up", row: DIR_UP },
      { key: "walk-left", row: DIR_LEFT },
      { key: "walk-down", row: DIR_DOWN },
      { key: "walk-right", row: DIR_RIGHT },
    ];

    for (const dir of directions) {
      if (this.anims.exists(dir.key)) continue;
      this.anims.create({
        key: dir.key,
        frames: this.anims.generateFrameNumbers("player", {
          start: dir.row * SPRITE_COLS + 1,
          end: dir.row * SPRITE_COLS + SPRITE_COLS - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Multiplayer join
  // ---------------------------------------------------------------------------

  private joinMultiplayer(x: number, y: number): void {
    if (
      !this.socket?.connected ||
      !this.socket.id ||
      !this.characterId ||
      this.joinedSocketId === this.socket.id
    )
      return;

    this.motionSnapshot.clear();
    this.peerSnapshotReady = false;
    this.playerSpawnReady = false;
    this.pendingPlayerResume = null;
    this.resumingPlayerGoal = null;
    this.motionGeneration++;
    this.pendingSeatClaims.clear();
    this.playerSeatGoal = null;
    this.spawnRequest = { x, y };
    this.spawnInputStarted = false;
    this.socket.emit("player:join", {
      characterId: this.characterId,
      characterName: this.characterName,
      appearance: this.appearance,
      mapId: this.channelId || "office",
      x,
      y,
    });
    this.joinedSocketId = this.socket.id;
  }

  // ---------------------------------------------------------------------------
  // Send position (throttled)
  // ---------------------------------------------------------------------------

  private sendPosition(x: number, y: number, direction: string, animation: string): void {
    if (!this.socket?.connected || !this.playerSpawnReady || !this.peerSnapshotReady) return;

    const motion =
      playerMotionGoal(this.currentPath, this.playerSeatGoal, TILE_SIZE) ??
      (!this.spawnInputStarted ? this.resumingPlayerGoal : null) ??
      null;
    const motionKey = JSON.stringify(motion);
    const now = Date.now();
    if (now - this.lastMoveSent < MOVE_SEND_INTERVAL) return;

    if (
      Math.abs(x - this.lastSentX) < 0.5 &&
      Math.abs(y - this.lastSentY) < 0.5 &&
      direction === this.lastSentDir &&
      animation === this.lastSentAnim &&
      motionKey === this.lastSentMotion
    ) {
      return;
    }

    this.lastMoveSent = now;
    this.lastSentX = x;
    this.lastSentY = y;
    this.lastSentDir = direction;
    this.lastSentAnim = animation;

    this.lastSentMotion = motionKey;
    this.socket.emit("player:move", { x, y, direction, animation, motion });
  }

  // ---------------------------------------------------------------------------
  // Speech bubbles (icon only, no text)
  // ---------------------------------------------------------------------------

  private npcBubbles: Map<string, Phaser.GameObjects.Container> = new Map();
  /** 활동 표시로 띄운 말풍선. "할 말 있음" 말풍선과 구분하기 위해 따로 센다. */
  private activityBubbles: Set<string> = new Set();

  private createBubbleIcon(x: number, y: number, text?: string): Phaser.GameObjects.Container {
    const container = this.add.container(x, y - 44);
    const gfx = this.add.graphics();

    if (text) {
      const label = this.add.text(0, -2, text, {
        fontSize: "11px",
        color: "#111827",
        fontStyle: "bold",
        padding: { left: 6, right: 6, top: 3, bottom: 3 },
      });
      label.setOrigin(0.5, 0.5);
      const width = Math.max(64, label.width + 12);
      const height = label.height + 8;
      gfx.fillStyle(0xffffff, 0.95);
      gfx.fillRoundedRect(-width / 2, -height / 2, width, height, 6);
      gfx.lineStyle(1, 0xcccccc, 0.8);
      gfx.strokeRoundedRect(-width / 2, -height / 2, width, height, 6);
      gfx.fillStyle(0xffffff, 0.95);
      gfx.fillTriangle(-4, height / 2 - 1, 4, height / 2 - 1, 0, height / 2 + 6);
      container.add(gfx);
      container.add(label);
    } else {
      // White bubble with subtle border
      gfx.fillStyle(0xffffff, 0.95);
      gfx.fillRoundedRect(-12, -11, 24, 18, 5);
      gfx.lineStyle(1, 0xcccccc, 0.8);
      gfx.strokeRoundedRect(-12, -11, 24, 18, 5);
      // Tail
      gfx.fillStyle(0xffffff, 0.95);
      gfx.fillTriangle(-3, 7, 3, 7, 0, 13);
      container.add(gfx);
      // Black dots
      const dots = this.add.graphics();
      dots.fillStyle(0x333333, 1);
      dots.fillCircle(-5, -2, 2);
      dots.fillCircle(0, -2, 2);
      dots.fillCircle(5, -2, 2);
      container.add(dots);
    }

    container.setDepth(20002);
    return container;
  }

  private showPlayerBubble(senderId: string): void {
    const remote =
      this.remotePlayers.get(senderId) ??
      [...this.remotePlayers.values()].find((player) => player.userId === senderId);
    if (!remote) return;

    const bubble = this.createBubbleIcon(remote.sprite.x, remote.sprite.y);

    // Player bubbles: fade after 4 seconds
    this.tweens.add({
      targets: bubble,
      alpha: 0,
      duration: 500,
      delay: 3500,
      onComplete: () => bubble.destroy(),
    });
  }

  private showNpcBubbleIcon(npcId: string, text?: string, durationMs?: number): void {
    if (this.npcBubbles.has(npcId)) {
      if (durationMs || !text) return;
      this.clearNpcBubble(npcId);
    }

    const npc = this.npcSprites.find((n) => n.id === npcId);
    if (!npc) return;

    const bubble = this.createBubbleIcon(npc.pixelX, npc.pixelY, text);
    this.npcBubbles.set(npcId, bubble);
    if (durationMs)
      this.time.delayedCall(durationMs, () => {
        // An old greeting must never clear a newer work/report bubble.
        if (this.npcBubbles.get(npcId) === bubble) this.clearNpcBubble(npcId);
      });
  }

  private clearNpcBubble(npcId: string): void {
    const bubble = this.npcBubbles.get(npcId);
    if (bubble) {
      bubble.destroy();
      this.npcBubbles.delete(npcId);
    }
  }

  // ---------------------------------------------------------------------------
  // NPC proximity check
  // ---------------------------------------------------------------------------

  private checkNpcProximity(): void {
    if (!this.playerReady || !this.player) return;

    const nearby: NpcSprite[] = [];
    for (const npc of this.npcSprites) {
      if (npc.distanceTo(this.player.x, this.player.y) < NPC_INTERACT_RADIUS) {
        nearby.push(npc);
      }
    }
    nearby.sort(
      (a, b) =>
        a.distanceTo(this.player.x, this.player.y) - b.distanceTo(this.player.x, this.player.y),
    );
    this.nearbyNpcs = nearby;

    // Auto-greet NPCs on first approach
    for (const npc of nearby) {
      if (!this.greetedNpcs.has(npc.id) && !this.dialogOpen && npc.moveState === "idle") {
        this.greetedNpcs.add(npc.id);
        EventBus.emit("npc:auto-greet", { npcId: npc.id, npcName: npc.name });
      }
    }

    // Check nearby remote players
    const nearbyP: { id: string; name: string }[] = [];
    for (const [id, remote] of this.remotePlayers) {
      if (remote.distanceTo(this.player.x, this.player.y) < NPC_INTERACT_RADIUS) {
        nearbyP.push({ id, name: remote.nameLabel.text });
      }
    }
    this.nearbyPlayers = nearbyP;

    const hasNearby = nearby.length > 0 || nearbyP.length > 0;

    // NPC dialog: auto-close when no NPCs nearby
    // But don't auto-close if an NPC is walking toward the player (delivering response)
    const npcApproaching = this.npcSprites.some((n) => n.moveState === "moving-to-player");
    if (
      this.dialogOpen &&
      nearby.length === 0 &&
      this.nearbyPlayers.length === 0 &&
      !npcApproaching
    ) {
      EventBus.emit("npc:dialog-auto-close");
    }

    // Channel chat: notify input enable/disable based on proximity to a talk target.
    // NPC 도 맵 채팅으로 지명할 수 있으므로(@[이름]), 사람 없이 NPC 만 근처에 있어도
    // 입력을 열어야 한다 — nearbyP 만 보면 혼자 있는 플레이어는 NPC 를 영영 부를 수 없다.
    const inputEnabled = hasNearby;
    if (inputEnabled !== this.lastChatInputEnabled) {
      this.lastChatInputEnabled = inputEnabled;
      EventBus.emit("chat:input-enabled", inputEnabled);
    }

    if (hasNearby && !this.dialogOpen) {
      const targetName = nearby.length > 0 ? nearby[0].name : nearbyP[0].name;
      // 문구 자체가 아니라 대상 이름으로 중복을 판단한다 — 번역은 React 가 한다.
      if (targetName !== this.lastToastMessage) {
        this.lastToastMessage = targetName;
        EventBus.emit("toast:show", {
          messageKey: "game.pressToTalk",
          params: { name: targetName },
        });
      }
    } else if (!this.dialogOpen) {
      if (this.lastToastMessage !== null) {
        this.lastToastMessage = null;
        EventBus.emit("toast:hide");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Y-sort depth helper
  // ---------------------------------------------------------------------------

  private updateYSortDepth(sprite: {
    y: number;
    displayHeight: number;
    originY: number;
    setDepth(v: number): void;
  }): void {
    // footY = pixel y of the character's bottom edge.
    // Base 10000 puts characters in the same depth range as foreground tile sprites
    // (depth = 10000 + tile.bottom) so per-tile y-sort works for all players/NPCs.
    const footY = sprite.y + sprite.displayHeight * (1 - sprite.originY);
    sprite.setDepth(10000 + footY);
  }

  private approachNpcAndInteract(npcId: string, npcName?: string): void {
    if (!this.player || !this.playerReady || !this.canMovePlayer()) return;

    const npc = this.npcSprites.find((entry) => entry.id === npcId);
    if (!npc || npc.moveState !== "idle") return;

    if (npc.distanceTo(this.player.x, this.player.y) < NPC_INTERACT_RADIUS) {
      EventBus.emit("npc:interact", { npcId: npc.id, npcName: npcName || npc.name });
      return;
    }

    const npcTileX = Math.floor(npc.pixelX / TILE_SIZE);
    const npcTileY = Math.floor(npc.pixelY / TILE_SIZE);
    const startTileX = Math.floor(this.player.x / TILE_SIZE);
    const startTileY = Math.floor(this.player.y / TILE_SIZE);

    let destTileX = npcTileX;
    let destTileY = npcTileY;
    const neighbors = [
      [npcTileX, npcTileY + 1],
      [npcTileX, npcTileY - 1],
      [npcTileX - 1, npcTileY],
      [npcTileX + 1, npcTileY],
    ];
    const walkable = neighbors.find(
      ([x, y]) => this.isWalkable(x, y) && !this.isTileOccupied(x, y),
    );
    if (walkable) {
      destTileX = walkable[0];
      destTileY = walkable[1];
    }

    if (!this.isWalkable(destTileX, destTileY) || this.isTileOccupied(destTileX, destTileY)) {
      const nearest = this.findNearestWalkableTile(destTileX, destTileY);
      if (!nearest) return;
      destTileX = nearest.x;
      destTileY = nearest.y;
    }

    const path = this.findPlayerPath(startTileX, startTileY, destTileX, destTileY);

    if (!path || path.length <= 1) {
      EventBus.emit("npc:interact", { npcId: npc.id, npcName: npcName || npc.name });
      return;
    }

    this.traffic.clear("player:local");
    this.currentPath = path;
    this.pathIndex = 1;
    this.pathStuckTimer = 0;
    this.pathLastDist = Infinity;
    this.targetNpcId = npc.id;
    this.drawPathLine(path);
  }

  // ---------------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------------

  /** 대기 중인 NPC 를 자리로 보낸다 — 타이머 만료와 채널 채팅 닫힘이 같은 경로를 쓴다. */
  private sendNpcHome(npc: NpcSprite): void {
    if (!this.mayDriveNpc(npc)) return;
    npc.waitTimer = 0;
    this.clearNpcBubble(npc.id);
    this.npcOwnership.startReturn(npc.id);
    this.socket?.emit("npc:return-home", { channelId: this.channelId, npcId: npc.id });
    npc.returnToHome(this.npcPathfinder(npc), this.createNpcWalkValidator());
    if (npc.moveState === "idle") this.finishNpcReturn(npc, true);
  }

  private returnDiagnosticAt = 0;
  private returnDiagnosticNode: HTMLOutputElement | null = null;
  private publishReturnDiagnostics() {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.NEXT_PUBLIC_DESKRPG_MOTION_DIAGNOSTICS !== "1" ||
      this.time.now - this.returnDiagnosticAt < 1000
    )
      return;
    this.returnDiagnosticAt = this.time.now;
    const states = this.npcSprites
      .filter(
        (npc) =>
          npc.moveState === "returning" ||
          this.motionSnapshot.current?.npcs.some(
            (state) => state.npcId === npc.id && state.phase === "returning",
          ),
      )
      .map((npc) => {
        const next = npc.currentPath?.[npc.pathIndex];
        return {
          name: npc.name,
          localOwner: this.npcOwnership.owner(npc.id) === this.socket?.id,
          drive: this.mayDriveNpc(npc),
          state: npc.moveState,
          position: [npc.pixelX, npc.pixelY],
          home: [npc.homeCol, npc.homeRow],
          homeWalkable: this.isWalkable(npc.homeCol, npc.homeRow),
          path: [npc.pathIndex, npc.currentPath?.length ?? 0],
          next,
          nextWalkable: next ? this.isWalkable(next.x, next.y) : null,
          nearby: this.trafficActors()
            .filter(
              (actor) =>
                actor.id !== npc.id &&
                Math.hypot(
                  actor.x - (npc.pixelX / TILE_SIZE - 0.5),
                  actor.y - (npc.pixelY / TILE_SIZE - 0.5),
                ) < 1.5,
            )
            .map(({ id, x, y }) => ({ id, x, y })),
        };
      });
    if (!states.length) {
      this.returnDiagnosticNode?.remove();
      this.returnDiagnosticNode = null;
      return;
    }
    if (!this.returnDiagnosticNode) {
      const node = document.createElement("output");
      node.id = "ui2-return-diagnostics";
      node.setAttribute("aria-label", "개발용 NPC 복귀 경로 진단");
      node.style.cssText =
        "position:fixed;bottom:0;left:0;z-index:99999;max-width:560px;max-height:100px;overflow:auto;font:10px monospace;background:#fff;color:#111;pointer-events:none";
      document.body.append(node);
      this.returnDiagnosticNode = node;
      this.eventScope.addCleanup(() => node.remove());
    }
    this.returnDiagnosticNode.textContent = JSON.stringify(states);
  }

  update(): void {
    this.playerActuallyWalking = false;
    this.publishReturnDiagnostics();
    // Lerp remote players every frame
    for (const remote of this.remotePlayers.values()) {
      remote.lerpUpdate();
    }

    this.updateRemoteNpcPresentation();

    // Remote snapshots keep arriving, but local input cannot race authoritative hydration.
    if (!this.canMovePlayer()) {
      (this.player?.body as Phaser.Physics.Arcade.Body | undefined)?.setVelocity(0, 0);
      return;
    }
    // Update NPC movement
    if (this.player) {
      const leader = this.isAmbientLeader();
      this.smalltalk.update(
        this.npcSprites.map((npc) => ({
          id: npc.id,
          name: npc.name,
          x: npc.pixelX / TILE_SIZE,
          y: npc.pixelY / TILE_SIZE,
          walking: npc.moveState === "strolling" || npc.remoteWalkingUntil > this.time.now,
          available:
            !this.npcOwnership.owner(npc.id) &&
            ambientAllowed(
              !!this.responsePhases[npc.id] ||
                this.activityBubbles.has(npc.id) ||
                this.npcBubbles.has(npc.id),
              this.dialogOpen,
              !!npc.calledForRoom,
            ) &&
            (npc.moveState === "idle" || npc.moveState === "strolling"),
        })),
        this.time.now,
        (a, b) => {
          // Do not greet through a wall or a row of shelves.
          for (let step = 1; step < 8; step++) {
            const x = Math.floor(a.x + ((b.x - a.x) * step) / 8);
            const y = Math.floor(a.y + ((b.y - a.y) * step) / 8);
            if (!this.isWalkable(x, y)) return false;
          }
          return true;
        },
      );
      for (const npc of this.npcSprites) {
        const partnerId = this.smalltalk.partner(npc.id, this.time.now);
        const partner = this.npcSprites.find((other) => other.id === partnerId);
        const paused = !!partner && leader;
        if (paused) {
          npc.pauseForSmalltalk(partner);
          if (!npc.ambientPaused && npc.moveState === "strolling") {
            this.socket?.emit("npc:position-update", {
              channelId: this.channelId,
              npcId: npc.id,
              continuation: this.npcContinuation(npc),
              x: npc.pixelX,
              y: npc.pixelY,
              direction: DIR_NUM_TO_NAME[npc.direction],
            });
            this.socket?.emit("npc:arrived", { channelId: this.channelId, npcId: npc.id });
          }
        }
        npc.ambientPaused = paused;
      }
      // Oldest ready worker gets the next available departure slot.
      const ambientOrder = [...this.npcSprites].sort(
        (a, b) =>
          b.ambientSchedule.elapsed -
          b.ambientSchedule.duration -
          (a.ambientSchedule.elapsed - a.ambientSchedule.duration),
      );
      for (const npc of ambientOrder) {
        const allowed =
          this.npcOwnership.mayRoam(npc.id, leader) &&
          ambientAllowed(
            !!this.responsePhases[npc.id] || this.activityBubbles.has(npc.id),
            this.dialogOpen,
            !!npc.calledForRoom,
          );
        if (!allowed) {
          if (npc.moveState === "strolling") {
            npc.stopStroll();
            if (leader)
              this.socket?.emit("npc:arrived", { channelId: this.channelId, npcId: npc.id });
          }
          npc.ambientTimer = 0;
          delete npc.ambientSchedule.seatTarget;
          delete npc.ambientSchedule.seatRest;
          continue;
        }
        if (npc.ambientPaused) continue;
        if (npc.moveState !== "idle" && npc.moveState !== "strolling") continue;
        if (npc.remoteWalkingUntil > this.time.now) continue;
        const sx = Math.floor(npc.pixelX / TILE_SIZE),
          sy = Math.floor(npc.pixelY / TILE_SIZE);
        if (!npc.ambientSeat) {
          // The persisted placement is the authoritative seat, never pick another chair.
          npc.ambientSeat = { x: npc.homeCol, y: npc.homeRow };
          // First arrival also establishes the working seat before starting a cycle.
          npc.ambientSchedule.phase = "home";
        }
        const home = npc.ambientSeat;
        const atHome =
          Math.hypot(npc.pixelX / TILE_SIZE - home.x - 0.5, npc.pixelY / TILE_SIZE - home.y - 0.5) <
          0.1;
        if (
          restAtAmbientSeat(
            npc.ambientSchedule,
            { x: npc.pixelX / TILE_SIZE - 0.5, y: npc.pixelY / TILE_SIZE - 0.5 },
            npc.moveState === "strolling",
            this.game.loop.delta,
          )
        )
          continue;
        const previousPhase = npc.ambientSchedule.phase;
        advanceAmbientSchedule(
          npc.ambientSchedule,
          this.game.loop.delta,
          atHome,
          Math.random,
          this.ambientDepartures.canDepart(
            this.time.now,
            this.npcSprites.filter(
              (other) => other !== npc && other.ambientSchedule.phase !== "rest",
            ).length,
          ),
        );
        if (previousPhase === "rest" && npc.ambientSchedule.phase !== "rest") {
          this.ambientDepartures.departed(this.time.now);
        }

        if (previousPhase !== "roam" && npc.ambientSchedule.phase === "roam") {
          npc.ambientExitPolicy = new AmbientExitPolicy(this.ambientZones, {
            x: npc.pixelX / TILE_SIZE - 0.5,
            y: npc.pixelY / TILE_SIZE - 0.5,
          });
        }
        if (npc.ambientSchedule.phase === "home") npc.ambientExitPolicy = null;
        if (previousPhase !== "home" && npc.ambientSchedule.phase === "home") npc.stopStroll();
        if (npc.moveState !== "idle" || npc.ambientSchedule.phase === "rest") continue;
        if (
          this.npcSprites.filter((other) => other !== npc && other.moveState === "strolling")
            .length >= 2
        )
          continue;
        npc.ambientTimer += Math.min(this.game.loop.delta, 100);
        if (npc.ambientTimer < npc.ambientSchedule.pause) continue;
        npc.ambientTimer = 0;
        const zoneWalkable =
          npc.ambientExitPolicy?.at({
            x: npc.pixelX / TILE_SIZE - 0.5,
            y: npc.pixelY / TILE_SIZE - 0.5,
          }) ?? ((x: number, y: number) => ambientTileAllowed(this.ambientZones, x, y));
        const walkable = (x: number, y: number) =>
          (npc.ambientSchedule.phase === "home" || zoneWalkable(x, y)) && this.isWalkable(x, y);
        const destinationFree = (x: number, y: number) =>
          clearActors(
            { x, y },
            { x, y },
            this.trafficActors().filter((actor) => actor.id !== npc.id),
          );
        const publicSeats = commonAreaSeats(this.mapObjects)
          .map((seat) => ({
            x: Math.floor(seat.anchorX ?? seat.x),
            y: Math.floor(seat.anchorZ ?? seat.z),
          }))
          .filter(
            (seat) =>
              ambientTileAllowed(this.ambientZones, seat.x, seat.y) &&
              !this.npcSprites.some(
                (other) =>
                  (other.homeCol === seat.x && other.homeRow === seat.y) ||
                  (other !== npc &&
                    other.ambientSchedule.seatTarget?.x === seat.x &&
                    other.ambientSchedule.seatTarget?.y === seat.y),
              ) &&
              walkable(seat.x, seat.y) &&
              destinationFree(seat.x, seat.y) &&
              (seat.x !== sx || seat.y !== sy),
          );
        const visitSeats =
          npc.ambientSchedule.phase === "roam" &&
          !npc.ambientSchedule.visitedSeat &&
          Math.random() < 0.6;
        const destinations =
          npc.ambientSchedule.phase === "home"
            ? [home]
            : ambientDestinations(
                this.floorData[0]?.length ?? 0,
                this.floorData.length,
                { x: sx, y: sy },
                (x, y) => walkable(x, y) && ambientTileAllowed(this.ambientZones, x, y),
              );
        if (visitSeats) {
          // Shuffle seats independently so room/cushion ordering does not bias every visit.
          for (let i = publicSeats.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [publicSeats[i], publicSeats[j]] = [publicSeats[j], publicSeats[i]];
          }
          destinations.unshift(...publicSeats);
        }
        // Bound A* work per attempt; retry later if this random batch is unreachable.
        for (const destination of destinations.slice(0, 12)) {
          if (
            !walkable(destination.x, destination.y) ||
            !destinationFree(destination.x, destination.y)
          )
            continue;
          const path = findPath(sx, sy, destination.x, destination.y, walkable);
          if (path && path.length > 0) {
            if (npc.ambientSchedule.phase === "roam") {
              const seat = publicSeats.find((s) => s.x === destination.x && s.y === destination.y);
              npc.ambientSchedule.seatTarget = seat;
              if (seat) npc.ambientSchedule.visitedSeat = true;
            }
            if (isSeatAnchor(this.mapObjects, destination.x, destination.y)) {
              const phase = npc.ambientSchedule.phase;
              this.reserveSeat(
                npc.id,
                (destination.x + 0.5) * TILE_SIZE,
                (destination.y + 0.5) * TILE_SIZE,
                (ok) => {
                  if (
                    ok &&
                    this.isAmbientLeader() &&
                    !this.npcOwnership.owner(npc.id) &&
                    npc.moveState === "idle" &&
                    this.npcSprites.filter(
                      (other) => other !== npc && other.moveState === "strolling",
                    ).length < 2 &&
                    npc.ambientSchedule.phase === phase
                  )
                    npc.startStroll(path);
                  else if (ok) this.releaseSeat(npc.id);
                },
              );
            } else {
              this.releaseSeat(npc.id);
              npc.startStroll(path);
            }
            break;
          }
        }
        npc.ambientSchedule.pause =
          npc.ambientSchedule.phase === "home" ? 1000 : randomDuration(2000, 6000);
      }
      // Auto-return NPCs that have been waiting long enough without an open dialog
      for (const npc of this.npcSprites) {
        if (
          this.mayDriveNpc(npc) &&
          shouldAutoReturn(npc, {
            dialogOpen: this.dialogOpen,
            visibleRoomId: this.visibleRoomId,
          })
        ) {
          npc.waitTimer += this.game.loop.delta;
          if (npc.waitTimer >= npc.waitDurationMs) this.sendNpcHome(npc);
        }
      }

      for (const npc of this.npcSprites) {
        if (!this.mayDriveNpc(npc)) continue;
        if (npc.ambientPaused && npc.moveState === "strolling") continue;
        if (npc.moveState === "idle" || npc.moveState === "waiting") {
          this.traffic.clear(npc.id);
          continue;
        }
        const destination = npc.currentPath?.[npc.currentPath.length - 1];
        if (
          npc.moveState === "strolling" &&
          destination &&
          isSeatAnchor(this.mapObjects, destination.x, destination.y) &&
          !this.motionSnapshot.current?.seats.some(
            (seat) =>
              seat.actorId === npc.id &&
              seat.seatId ===
                `${(destination.x + 0.5) * TILE_SIZE}:${(destination.y + 0.5) * TILE_SIZE}`,
          )
        ) {
          npc.stopStroll();
          continue;
        }
        const wasStrolling = npc.moveState === "strolling";
        const position = { x: npc.pixelX / TILE_SIZE - 0.5, y: npc.pixelY / TILE_SIZE - 0.5 };
        const zoneWalkable =
          npc.ambientExitPolicy?.at(position) ??
          ((x: number, y: number) => ambientTileAllowed(this.ambientZones, x, y));
        const npcWalkable = this.createNpcWalkValidator();
        const routeWalkable = (x: number, y: number) =>
          npcWalkable(x, y) &&
          (!wasStrolling || npc.ambientSchedule.phase === "home" || zoneWalkable(x, y));
        const result = npc.updateMovement(
          this.game.loop.delta,
          this.player.x,
          this.player.y,
          this.npcPathfinder(npc),
          routeWalkable,
          (position, goal, amount) => {
            const zoneWalkable =
              npc.ambientExitPolicy?.at(position) ??
              ((x: number, y: number) => ambientTileAllowed(this.ambientZones, x, y));
            return this.traffic.step(
              npc.id,
              position,
              goal,
              amount,
              this.time.now,
              (x, y) =>
                this.isWalkable(x, y) &&
                (!wasStrolling || npc.ambientSchedule.phase === "home" || zoneWalkable(x, y)),
              this.trafficActors(),
            );
          },
        );
        if (wasStrolling && result === "idle") {
          this.socket?.emit("npc:position-update", {
            channelId: this.channelId,
            npcId: npc.id,
            continuation: this.npcContinuation(npc),
            x: npc.pixelX,
            y: npc.pixelY,
            direction: DIR_NUM_TO_NAME[npc.direction],
          });
          this.socket?.emit("npc:arrived", { channelId: this.channelId, npcId: npc.id });
        }
        if (result === "arrived") {
          if (!npc.calledForRoom || npc.pendingReportId)
            EventBus.emit("npc:bubble", {
              npcId: npc.id,
              text: npc.arrivalBubbleText || undefined,
            });
          EventBus.emit("toast:show", {
            messageKey: "game.pressToTalk",
            params: { name: npc.name },
          });
          EventBus.emit("npc:movement-arrived", {
            npcId: npc.id,
            npcName: npc.name,
            pendingMessage: npc.pendingMessage,
            reportId: npc.pendingReportId,
            reportKind: npc.pendingReportKind,
          });
          publishNpcArrival((event, payload) => this.socket?.emit(event, payload), {
            channelId: this.channelId,
            npcId: npc.id,
            x: npc.pixelX,
            y: npc.pixelY,
            direction: DIR_NUM_TO_NAME[npc.direction],
          });
        } else if (result === "returning-done") {
          this.npcTilePositions.add(`${npc.homeCol},${npc.homeRow}`);
          this.finishNpcReturn(npc, true);
        }
      }

      // Update NPC bubble positions to follow sprites
      for (const [npcId, bubble] of this.npcBubbles) {
        const npc = this.npcSprites.find((n) => n.id === npcId);
        if (npc) bubble.setPosition(npc.sprite.x, npc.sprite.y - 44);
      }

      // Preserve rest and pause clocks too; position updates alone miss stationary ambient state.
      this.npcContinuationTimer += this.game.loop.delta;
      if (this.npcContinuationTimer >= 1000) {
        this.npcContinuationTimer = 0;
        for (const npc of this.npcSprites) {
          if (this.mayDriveNpc(npc))
            this.socket?.emit("npc:continuation-update", {
              channelId: this.channelId,
              npcId: npc.id,
              continuation: this.npcContinuation(npc),
            });
        }
      }
      // Sync moving NPC positions to server every 200ms
      this.npcPositionSyncTimer += this.game.loop.delta;
      if (this.npcPositionSyncTimer >= 200) {
        this.npcPositionSyncTimer = 0;
        for (const npc of this.npcSprites) {
          if (!this.mayDriveNpc(npc)) continue;
          if (
            npc.moveState === "moving-to-player" ||
            npc.moveState === "returning" ||
            (npc.moveState === "strolling" && !npc.ambientPaused)
          ) {
            this.socket?.emit("npc:position-update", {
              channelId: this.channelId,
              npcId: npc.id,
              continuation: this.npcContinuation(npc),
              x: npc.pixelX,
              y: npc.pixelY,
              direction: DIR_NUM_TO_NAME[npc.direction] ?? "down",
            });
          }
        }
      }
    }

    // Predefined environments: Tab remains available for browser focus navigation.
    // The legacy editor implementation is retained for its dedicated authoring route.

    // Editor mode: handle layer/object switching with number keys and O key
    if (this.editorMode) {
      // O key: toggle between tile mode and object mode
      if (this.editorKeys.oKey && Phaser.Input.Keyboard.JustDown(this.editorKeys.oKey)) {
        this.editorObjectMode = !this.editorObjectMode;
        this.updateLayerText();
        if (!this.editorObjectMode && this.editorObjectPreview) {
          this.editorObjectPreview.destroy();
          this.editorObjectPreview = null;
        }
      }

      if (this.editorObjectMode) {
        // Number keys 1-9 select object type
        const typeList = OBJECT_TYPE_LIST;
        const numKeys = [this.editorKeys.one, this.editorKeys.two, this.editorKeys.three];
        for (let i = 0; i < numKeys.length && i < typeList.length; i++) {
          const key = numKeys[i];
          if (key && Phaser.Input.Keyboard.JustDown(key)) {
            this.selectedObjectType = typeList[i].id;
            this.updateLayerText();
            // Destroy existing preview so it recreates with new texture
            if (this.editorObjectPreview) {
              this.editorObjectPreview.destroy();
              this.editorObjectPreview = null;
            }
          }
        }
      } else {
        // Tile mode: number keys select layer
        if (this.editorKeys.one && Phaser.Input.Keyboard.JustDown(this.editorKeys.one)) {
          this.selectedLayer = 0;
          this.updateLayerText();
        }
        if (this.editorKeys.two && Phaser.Input.Keyboard.JustDown(this.editorKeys.two)) {
          this.selectedLayer = 1;
          this.updateLayerText();
        }
      }
    }

    // Placement mode: show tile highlight under cursor
    if (this.placementMode) {
      const pointer = this.input.activePointer;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const col = Math.floor(worldPoint.x / TILE_SIZE);
      const row = Math.floor(worldPoint.y / TILE_SIZE);
      if (this.canPlaceAt(col, row)) {
        if (!this.placementHighlight) {
          this.placementHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0x4f46e5, 0.4);
          this.placementHighlight.setDepth(20020);
        }
        this.placementHighlight.setPosition(
          col * TILE_SIZE + TILE_SIZE / 2,
          row * TILE_SIZE + TILE_SIZE / 2,
        );
        this.placementHighlight.setVisible(true);
      } else {
        this.placementHighlight?.setVisible(false);
      }
      return; // Skip normal movement in placement mode
    }

    // Spawn set mode: show green tile highlight under cursor
    if (this.spawnSetMode) {
      const pointer = this.input.activePointer;
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const col = Math.floor(worldPoint.x / TILE_SIZE);
      const row = Math.floor(worldPoint.y / TILE_SIZE);
      if (this.isWalkable(col, row)) {
        if (!this.spawnHighlight) {
          this.spawnHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0x22c55e, 0.5);
          this.spawnHighlight.setDepth(20020);
        }
        this.spawnHighlight.setPosition(
          col * TILE_SIZE + TILE_SIZE / 2,
          row * TILE_SIZE + TILE_SIZE / 2,
        );
        this.spawnHighlight.setVisible(true);
      } else {
        this.spawnHighlight?.setVisible(false);
      }
      return; // Skip normal movement in spawn set mode
    }

    if (!this.playerReady || !this.player?.body) return;

    this.checkNpcProximity();

    // / key for NPC/player interaction
    if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      const activeEl = document.activeElement as HTMLElement | null;
      const isTypingTarget =
        !!activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.isContentEditable);
      if (isTypingTarget) {
        return;
      }
      if (!this.dialogOpen) {
        const npcEntries = this.nearbyNpcs.map((n) => ({
          id: n.id,
          name: n.name,
          type: "npc" as const,
        }));
        const playerEntries = this.nearbyPlayers.map((p) => ({
          id: p.id,
          name: p.name,
          type: "player" as const,
        }));
        const allNearby = [...npcEntries, ...playerEntries];

        if (allNearby.length === 1) {
          if (allNearby[0].type === "npc") {
            EventBus.emit("npc:interact", { npcId: allNearby[0].id, npcName: allNearby[0].name });
          } else {
            EventBus.emit("player:chat-open");
          }
        } else if (allNearby.length > 1) {
          EventBus.emit("interact:select", { targets: allNearby });
        }
      }
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Detect keyboard input
    const left = this.cursors?.left.isDown;
    const right = this.cursors?.right.isDown;
    const up = this.cursors?.up.isDown;
    const down = this.cursors?.down.isDown;
    const hasKeyboardInput = left || right || up || down;
    if (hasKeyboardInput) {
      this.spawnInputStarted = true;
      if (this.playerSeatGoal) {
        this.releaseSeat(this.socket?.id ?? "");
        this.playerSeatGoal = null;
      }
    }

    // Arrow keys cancel path following
    if (hasKeyboardInput && this.currentPath) {
      this.traffic.clear("player:local");
      this.currentPath = null;
      this.clearPathLine();
      this.targetNpcId = null;
    }

    // Reserve a seat before approaching it; contention never resolves by overlapping actors.
    if (this.currentPath?.length && this.socket?.id) {
      const goal = this.currentPath[this.currentPath.length - 1];
      const goalId = `${(goal.x + 0.5) * TILE_SIZE}:${(goal.y + 0.5) * TILE_SIZE}`;
      if (this.playerSeatGoal && this.playerSeatGoal !== goalId) {
        this.releaseSeat(this.socket.id);
        this.playerSeatGoal = null;
      }
      if (isSeatAnchor(this.mapObjects, goal.x, goal.y) && this.playerSeatGoal !== goalId) {
        const path = this.currentPath;
        body.setVelocity(0, 0);
        if (!this.pendingSeatClaims.has(this.socket.id))
          this.reserveSeat(
            this.socket.id,
            (goal.x + 0.5) * TILE_SIZE,
            (goal.y + 0.5) * TILE_SIZE,
            (ok) => {
              if (this.currentPath !== path) {
                if (ok) this.releaseSeat(this.socket?.id ?? "");
                return;
              }
              if (ok) this.playerSeatGoal = goalId;
              else {
                this.currentPath = null;
                this.clearPathLine();
              }
            },
          );
        return;
      }
    }
    // Path following
    if (this.currentPath && this.pathIndex < this.currentPath.length) {
      const target = this.currentPath[this.pathIndex];
      const targetPixelX = target.x * TILE_SIZE + TILE_SIZE / 2;
      const targetPixelY = target.y * TILE_SIZE + TILE_SIZE / 2;

      const dx = targetPixelX - this.player.x;
      const dy = targetPixelY - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.pathLastDist - 0.5) {
        this.pathStuckTimer = 0;
        this.pathLastDist = dist;
      } else {
        this.pathStuckTimer++;
      }

      // Seats require reaching the center, unlike ordinary walking destinations.
      const arrivingAtSeat =
        this.pathIndex === this.currentPath.length - 1 &&
        isSeatAnchor(this.mapObjects, target.x, target.y);
      if (arrivingAtSeat && this.isTileOccupied(target.x, target.y)) {
        this.releaseSeat(this.socket?.id ?? "");
        this.playerSeatGoal = null;
        this.currentPath = null;
        this.clearPathLine();
        body.setVelocity(0, 0);
        return;
      }
      const reached = dist < 2;
      if (reached) {
        body.setVelocity(0, 0);
        this.pathIndex++;
        this.pathStuckTimer = 0;
        this.pathLastDist = Infinity;
        if (this.pathIndex >= this.currentPath.length) {
          this.currentPath = null;
          this.traffic.clear("player:local");
          this.clearPathLine();
          body.setVelocity(0, 0);

          if (this.targetNpcId) {
            const npc = this.npcSprites.find((n) => n.id === this.targetNpcId);
            if (npc) {
              EventBus.emit("npc:interact", { npcId: npc.id, npcName: npc.name });
            }
            this.targetNpcId = null;
          }
        }
      } else {
        const dt = Math.max(0.001, Math.min(this.game.loop.delta, 100) / 1000);
        const next = this.traffic.step(
          "player:local",
          { x: this.player.x / TILE_SIZE - 0.5, y: this.player.y / TILE_SIZE - 0.5 },
          target,
          Math.min(PLAYER_SPEED * dt, dist) / TILE_SIZE,
          this.time.now,
          (x, y) => this.isWalkable(x, y),
          this.trafficActors(),
        );
        const vx = ((next.x + 0.5) * TILE_SIZE - this.player.x) / dt;
        const vy = ((next.y + 0.5) * TILE_SIZE - this.player.y) / dt;
        this.playerActuallyWalking = commitPlayerStep(
          body,
          { x: this.player.x, y: this.player.y },
          { x: (next.x + 0.5) * TILE_SIZE, y: (next.y + 0.5) * TILE_SIZE },
        );

        if (Math.abs(vx) > Math.abs(vy)) {
          this.currentDirection = vx > 0 ? DIR_RIGHT : DIR_LEFT;
        } else if (vy !== 0) {
          this.currentDirection = vy > 0 ? DIR_DOWN : DIR_UP;
        }

        const walkKey = `walk-${DIR_NUM_TO_NAME[this.currentDirection]}`;
        if (vx === 0 && vy === 0) {
          this.player.anims.stop();
          this.player.setFrame(this.currentDirection * SPRITE_COLS);
        } else if (this.player.anims.currentAnim?.key !== walkKey) {
          this.player.play(walkKey, true);
        }
      }

      this.sendPosition(
        this.player.x,
        this.player.y,
        DIR_NUM_TO_NAME[this.currentDirection],
        this.playerActuallyWalking ? "walk" : "idle",
      );

      // Update player name label position
      if (this.playerNameLabel && this.player) {
        this.playerNameLabel.setPosition(this.player.x, this.player.y - 44);
      }
      // Y-sort depth ordering (path following early-return path)
      if (this.player) this.updateYSortDepth(this.player);
      for (const remote of this.remotePlayers.values()) {
        if (remote.sprite) this.updateYSortDepth(remote.sprite);
      }
      for (const npc of this.npcSprites) {
        if (npc.sprite) this.updateYSortDepth(npc.sprite);
      }
      for (const sprite of this.ySortObjectSprites.values()) {
        this.updateYSortDepth(sprite);
      }
      return;
    }

    // Manual collision check (since we don't use layer colliders with multi-layer)
    if (hasKeyboardInput) {
      // Check if the next tile is walkable
      const currentTileX = Math.floor(this.player.x / TILE_SIZE);
      const currentTileY = Math.floor(this.player.y / TILE_SIZE);

      let vx = 0;
      let vy = 0;

      // Check horizontal movement (walkable + not occupied by NPC/player)
      if (left) {
        const checkX = Math.floor((this.player.x - 12) / TILE_SIZE);
        if (this.isWalkable(checkX, currentTileY)) vx = -PLAYER_SPEED;
      } else if (right) {
        const checkX = Math.floor((this.player.x + 12) / TILE_SIZE);
        if (this.isWalkable(checkX, currentTileY)) vx = PLAYER_SPEED;
      }

      // Check vertical movement (walkable + not occupied by NPC/player)
      if (up) {
        const checkY = Math.floor((this.player.y - 12) / TILE_SIZE);
        if (this.isWalkable(currentTileX, checkY)) vy = -PLAYER_SPEED;
      } else if (down) {
        const checkY = Math.floor((this.player.y + 12) / TILE_SIZE);
        if (this.isWalkable(currentTileX, checkY)) vy = PLAYER_SPEED;
      }

      if (vx !== 0 && vy !== 0) {
        const factor = Math.SQRT1_2;
        vx *= factor;
        vy *= factor;
      }

      const dt = Math.min(this.game.loop.delta, 100) / 1000;
      if (
        !clearMovementSegment(
          { x: this.player.x / TILE_SIZE - 0.5, y: this.player.y / TILE_SIZE - 0.5 },
          {
            x: (this.player.x + vx * dt) / TILE_SIZE - 0.5,
            y: (this.player.y + vy * dt) / TILE_SIZE - 0.5,
          },
          (x, y) => this.isWalkable(x, y),
        ) ||
        !clearActors(
          { x: this.player.x / TILE_SIZE - 0.5, y: this.player.y / TILE_SIZE - 0.5 },
          {
            x: (this.player.x + vx * dt) / TILE_SIZE - 0.5,
            y: (this.player.y + vy * dt) / TILE_SIZE - 0.5,
          },
          this.trafficActors().filter((actor) => actor.id !== "player:local"),
        )
      ) {
        vx = 0;
        vy = 0;
      }
      this.playerActuallyWalking = commitPlayerStep(
        body,
        { x: this.player.x, y: this.player.y },
        { x: this.player.x + vx * dt, y: this.player.y + vy * dt },
      );

      if (vx !== 0 || vy !== 0) {
        if (Math.abs(vx) >= Math.abs(vy)) {
          this.currentDirection = vx < 0 ? DIR_LEFT : DIR_RIGHT;
        } else {
          this.currentDirection = vy < 0 ? DIR_UP : DIR_DOWN;
        }

        const animKey = `walk-${DIR_NUM_TO_NAME[this.currentDirection]}`;
        this.player.anims.play(animKey, true);

        this.sendPosition(
          this.player.x,
          this.player.y,
          DIR_NUM_TO_NAME[this.currentDirection],
          "walk",
        );
      } else {
        this.player.anims.stop();
        this.player.setFrame(this.currentDirection * SPRITE_COLS);

        this.sendPosition(
          this.player.x,
          this.player.y,
          DIR_NUM_TO_NAME[this.currentDirection],
          "idle",
        );
      }
    } else {
      body.setVelocity(0, 0);
      this.player.anims.stop();
      this.player.setFrame(this.currentDirection * SPRITE_COLS);

      this.sendPosition(
        this.player.x,
        this.player.y,
        DIR_NUM_TO_NAME[this.currentDirection],
        "idle",
      );
    }

    // Update player name label position
    if (this.playerNameLabel && this.player) {
      this.playerNameLabel.setPosition(this.player.x, this.player.y - 40);
    }
    // Y-sort depth ordering
    if (this.player) {
      this.updateYSortDepth(this.player);
    }
    for (const remote of this.remotePlayers.values()) {
      if (remote.sprite) this.updateYSortDepth(remote.sprite);
    }
    for (const npc of this.npcSprites) {
      if (npc.sprite) this.updateYSortDepth(npc.sprite);
    }
    for (const sprite of this.ySortObjectSprites.values()) {
      this.updateYSortDepth(sprite);
    }
  }
}
