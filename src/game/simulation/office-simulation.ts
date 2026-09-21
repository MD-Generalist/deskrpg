/**
 * 화면 없는 오피스 시뮬레이션.
 *
 * 플레이어·NPC·원격 플레이어의 위치와 상태를 굴리고, 소켓과 EventBus 로 페이지와 대화하며,
 * 결과를 `OfficeBridge` 로 렌더러(three.js)에 내보낸다. 이 모듈은 그리지 않는다 — 텍스처·
 * 스프라이트·카메라가 없고, 브라우저 API 는 `start()` 뒤의 rAF 루프와 키보드 리스너뿐이다.
 * 생성만으로는 DOM 을 건드리지 않으므로 node 에서 핸들러를 직접 검사할 수 있다.
 */
import type { Socket } from "socket.io-client";
import { isNpcCallRejected, npcCallErrorKey } from "../../lib/npc-call-errors";
import { EventBus, pendingChannelData, setPendingChannelData } from "../EventBus";
import {
  DEFAULT_NPC_MOTION,
  normalizeNpcMotionConfig,
  type NpcMotionConfig,
} from "../../lib/npc-motion-config";
import { effectiveMapSpawn } from "../../lib/effective-map-spawn";
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
  adoptNpcMotionHome,
  type MotionNpc,
  type MotionSnapshot,
} from "../motion-snapshot";
import { NpcMovementOwnership, publishNpcArrival } from "../npc-movement-ownership";
import { findPath, clearMovementSegment, type NavigationPoint } from "../navigation";
import { TrafficCoordinator, clearActors, findTrafficPath, type TrafficActor } from "../traffic";
import { peerMovementUncertainty, type PeerMotionSample } from "../peer-motion-envelope";
import {
  ambientTileAllowed,
  destinationTileAllowed,
  findTaggedDestinationPath,
  taggedPathTileAllowed,
  AmbientExitPolicy,
  type AmbientZone,
} from "../ambient-zones";
import { isSeatAnchor, isDeskSeatAnchor, deskSeatLabels, commonAreaSeats } from "../three/seating";
import { resolveSeatIntent, seatReservationId } from "../three/seat-action";
import {
  AmbientDepartures,
  ambientAllowed,
  ambientDestinations,
  createAmbientSchedule,
  advanceAmbientSchedule,
  randomDuration,
  restAtAmbientSeat,
} from "../npc-ambient";
import { NpcSmalltalk } from "../npc-smalltalk";
import { createEventScope } from "../three/event-scope";
import {
  matchesNpcTarget,
  type OfficeBridge,
  type ActorSnapshot,
  type EditorSnapshot,
} from "../three/bridge";
import { fetchChannelNpcs } from "../npc-prefetch";
import { shouldAutoReturn, shouldReturnOnRoomChange } from "../npc-auto-return";
import { decideNpcClick, shouldRememberTarget } from "../npc-click-intent";
import { decideNpcUpdate, type NpcUpdatedPayload } from "../npc-updated-dispatch";
import { createRejoinTracker, registerOnce, shouldRejoinForError } from "../socket-rejoin";
import { type MapObject } from "../../lib/object-types";
import { normalizeMeetingMap } from "../meeting-map-normalization";
import { insideMeetingSpace, type MeetingSpace } from "../meeting-space";
import { NpcController, type NpcData, type NpcPathfinder } from "./npc-controller";
import { RemotePlayer, type RemotePlayerData } from "./remote-player";
import { TickLoop } from "./tick-loop";
import { Scheduler } from "./scheduler";
import { loadLegacyRuntime, loadTiledRuntime, occupiedTiles, type MapRuntime } from "./map-runtime";
import {
  COLLISION_TILES,
  MAP_COLS,
  MAP_ROWS,
  MOVE_SEND_INTERVAL,
  NPC_INTERACT_RADIUS,
  PLAYER_SPEED,
  TILE_EMPTY,
  TILE_SIZE,
} from "./constants";
import {
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  directionFromName,
  directionName,
} from "./directions";

type PlayerBody = { x: number; y: number };

/** 입력 상자·편집 가능한 요소에 포커스가 있으면 게임 키를 가로채지 않는다. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

/** 옛 게임 루프가 브라우저에서 가로채던 키. 화살표(스크롤)·슬래시(Firefox 빠른 찾기). */
const CAPTURED_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]);

type PendingNpcCall = {
  npcId: string;
  message?: string;
  bubbleText?: string;
  npcName?: string;
  reason?: string;
  roomId?: string;
};

/** 한 번 위치 보고에 움직여도 되는 거리(px) — 옛 걸음 150px/s 가 200ms 에 가던 거리다. */
const NPC_SYNC_CHORD_PX = 30;
const NPC_SYNC_MAX_INTERVAL_MS = 200;
/** 초당 20번보다 자주 보내지 않는다 — 최고 속도(480px/s)에서도 62ms 라 여기에 닿지 않는다. */
const NPC_SYNC_MIN_INTERVAL_MS = 50;

export class OfficeSimulation {
  // ---------------------------------------------------------------------------
  // 수명 · 시계
  // ---------------------------------------------------------------------------
  private disposed = false;
  private paused = false;
  private booted = false;
  /** rAF 시각(ms). 소켓 핸들러도 마지막 틱의 값을 본다 — 옛 씬 시계와 같다. */
  private now = 0;
  private delta = 0;
  private loop = new TickLoop((now, delta) => this.step(now, delta));
  private scheduler = new Scheduler();
  private eventScope = createEventScope();
  private keysDown = new Set<string>();
  private justPressed = new Set<string>();

  // ---------------------------------------------------------------------------
  // 회의
  // ---------------------------------------------------------------------------
  private meetingMode = false;
  private meetingEntryPending = false;
  private meetingEntryStartedAt = 0;
  private meetingEntryPath: NavigationPoint[] | null = null;
  private meetingSeatTarget: string | null = null;
  private spatialNpcRoutes = new Map<string, { generation: number; done: boolean }>();

  // ---------------------------------------------------------------------------
  // 이동 조정 · 스냅샷
  // ---------------------------------------------------------------------------
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
  private pendingNpcCalls = new Map<string, PendingNpcCall>();
  private speechPreviews = new SpeechPreviews();
  private smalltalk = new NpcSmalltalk();
  private responsePhases: Record<string, "queued" | "thinking" | "streaming"> = {};
  /** 카드 실행·크론 실행 중인 NPC(R27). `npc:working-state` 로 통째로 갱신된다. */
  private workingNpcs = new Set<string>();
  /** npcId → 진행 중인 건수. 한 직원이 여러 장을 돌릴 수 있어 개수까지 받는다. */
  private workingCounts: Record<string, number> = {};

  // ---------------------------------------------------------------------------
  // 플레이어
  // ---------------------------------------------------------------------------
  private player: PlayerBody | null = null;
  private currentDirection: number = DIR_DOWN;
  private playerReady = false;
  private playerActuallyWalking = false;

  // ---------------------------------------------------------------------------
  // 멀티플레이
  // ---------------------------------------------------------------------------
  private socket: Socket | null = null;
  private rejoin = createRejoinTracker();
  private joinedSocketId: string | undefined = undefined;
  private localPlayerIdentity: { socketId: string; userId: string } | undefined;
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

  // ---------------------------------------------------------------------------
  // NPC
  // ---------------------------------------------------------------------------
  private npcs: NpcController[] = [];
  private npcTilePositions: Set<string> = new Set(); // "col,row" — 스폰 충돌 검사용
  private npcPositionSyncTimer = 0;
  private nearbyNpcs: NpcController[] = [];
  private nearbyPlayers: { id: string; name: string }[] = [];
  private dialogOpen = false;
  /** 어느 방의 대화가 보이는가 — GamePageClient 가 room:visible 로 알려 준다. null 이면 보이는 방이 없음. */
  private visibleRoomId: string | null = null;
  private lastToastMessage: string | null = null;
  private lastChatInputEnabled: boolean | null = null;
  private greetedNpcs: Set<string> = new Set();
  /** NPC 말풍선. 텍스트가 없으면 "할 말 있음"(점 세 개)이다. */
  private npcBubbles: Map<string, { text?: string }> = new Map();
  /** 활동 표시로 띄운 말풍선. "할 말 있음" 말풍선과 구분하기 위해 따로 센다. */
  private activityBubbles: Set<string> = new Set();

  // ---------------------------------------------------------------------------
  // 경로 추종
  // ---------------------------------------------------------------------------
  private currentPath: NavigationPoint[] | null = null;
  private pathIndex = 0;
  private targetNpcId: string | null = null;
  private pathStuckTimer = 0;
  private pathLastDist = Infinity;

  // ---------------------------------------------------------------------------
  // 맵
  // ---------------------------------------------------------------------------
  private floorData: number[][] = [];
  private wallsData: number[][] = [];
  private collisionData: number[][] = [];
  private effectiveMapCols: number = MAP_COLS;
  private effectiveMapRows: number = MAP_ROWS;
  private mapObjects: MapObject[] = [];
  private collisionCells = new Set<string>();
  private objectOccupiedTiles = new Set<string>();
  private mapRevision?: string;
  private channelId = "";
  private meetingSpace: MeetingSpace | undefined;
  /**
   * 채널의 NPC 걸음 속도. 채널 공유 설정이다 — 이 브라우저가 NPC 를 구동하면 이 값으로 걷고,
   * 다른 사람은 방송된 위치를 따라가므로 모두 같은 속도를 본다.
   */
  private motion: NpcMotionConfig = DEFAULT_NPC_MOTION;
  private tiledMode = false;
  private officeEnvironment: string | undefined;
  private officeEnvironmentVersion: number | undefined;
  private ambientZones: AmbientZone[] = [];
  private tiledSpawnCol: number | null = null;
  private tiledSpawnRow: number | null = null;
  private savedPosition: { x: number; y: number } | null = null;
  private mapConfigSpawnCol: number | null = null;
  private mapConfigSpawnRow: number | null = null;

  // ---------------------------------------------------------------------------
  // 배치 · 시작 위치 지정
  // ---------------------------------------------------------------------------
  private placementMode = false;
  /** 자리 변경 모드 번호 라벨 캐시 — 모드 진입·NPC 추가/제거 때 비운다. */
  private seatLabelCache: EditorSnapshot["seatLabels"] | null = null;
  private placementNpcId: string | null = null;
  private isChannelOwner = false;
  private spawnSetMode = false;

  // ---------------------------------------------------------------------------
  // 진단(개발용)
  // ---------------------------------------------------------------------------
  private returnDiagnosticAt = 0;
  private returnDiagnosticNode: HTMLOutputElement | null = null;

  // ===========================================================================
  // 수명
  // ===========================================================================

  /**
   * 브라우저 진입점. 페이지가 `setPendingChannelData` 로 넘긴 채널 데이터를 소비해 맵을 세우고,
   * `scene-ready`·`three:bridge-ready`·`request-socket` 을 낸 뒤 틱 루프를 돈다.
   * 채널 데이터가 아직 없으면 `channel-data-ready` 를 기다렸다가 같은 절차를 밟는다.
   */
  start(): void {
    if (this.disposed) return;
    const data = pendingChannelData;
    const source = data?.tiledJson ?? data?.mapData;
    if (!data || !source) {
      // 옛 씬의 "Loading channel map..." 대기 상태. 데이터가 오면 처음부터 다시 세운다.
      const handleChannelDataReady = () => {
        EventBus.off("channel-data-ready", handleChannelDataReady);
        if (!this.disposed) this.start();
      };
      this.eventScope.on("channel-data-ready", handleChannelDataReady);
      return;
    }
    this.boot(data);
    this.loop.start();
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
    this.eventScope.addCleanup(() => {
      window.removeEventListener("keydown", this.handleKeyDown);
      window.removeEventListener("keyup", this.handleKeyUp);
      window.removeEventListener("blur", this.handleWindowBlur);
    });
    // 소켓이 이미 준비돼 있었을 수 있으니 다시 요청한다.
    EventBus.emit("request-socket");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.scheduler.clear();
    // 이 시뮬레이션이 건 리스너만 떼어 낸다 — 페이지의 EventBus 리스너는 남는다.
    this.eventScope.dispose();
    EventBus.off("socket-rejoin", this.handleSocketRejoin);
    this.socketListenerCleanup = null;
    this.returnDiagnosticNode?.remove();
    this.returnDiagnosticNode = null;
  }

  /** 렌더러가 소비하는 시뮬레이션 상태. */
  readonly officeBridge: OfficeBridge = {
    actors: () => this.actors(),
    mapKey: () =>
      JSON.stringify([
        this.effectiveMapCols,
        this.effectiveMapRows,
        this.floorData,
        this.wallsData,
        this.mapObjects,
        this.tiledMode,
        this.officeEnvironment,
      ]),
    map: () => {
      const blocked: string[] = [];
      for (let row = 0; row < this.effectiveMapRows; row++)
        for (let col = 0; col < this.effectiveMapCols; col++) {
          if (!this.isWalkable(col, row)) blocked.push(`${col},${row}`);
        }
      return {
        meetingSpace: this.meetingSpace,
        cols: this.effectiveMapCols,
        rows: this.effectiveMapRows,
        floor: this.floorData,
        walls: this.wallsData,
        blocked,
        objects: this.mapObjects,
        tiled: this.tiledMode,
        environment: this.officeEnvironment,
        environmentVersion: this.officeEnvironmentVersion,
      };
    },
    editor: () => ({
      placement: this.placementMode,
      spawn: this.spawnSetMode,
      owner: this.isChannelOwner,
      tiled: this.tiledMode,
      seatLabels: this.placementMode
        ? (this.seatLabelCache ??= deskSeatLabels(
            this.mapObjects,
            (col, row) => this.isWalkable(col, row),
            (col, row) =>
              this.npcs.some(
                (n) => n.id !== this.placementNpcId && n.homeCol === col && n.homeRow === row,
              ),
          ))
        : [],
    }),
    pointer: (kind, x, y, button, screenX, screenY, actorId) => {
      this.presentationActorId = actorId;
      if (kind === "down") this.handlePointerDown(x, y, button, screenX, screenY);
      this.presentationActorId = undefined;
    },
    walkable: (col, row) => this.isWalkable(col, row) && !this.isTileOccupied(col, row),
    seatAvailable: (x, z) => {
      const col = Math.floor(x),
        row = Math.floor(z);
      if (!this.isWalkable(col, row) || this.isTileOccupied(col, row)) return false;
      const seatId = seatReservationId(col + 0.5, row + 0.5);
      return !this.motionSnapshot.current?.seats.some((seat) => seat.seatId === seatId);
    },
    seatIntent: () => {
      const goal = this.currentPath?.[this.currentPath.length - 1];
      return resolveSeatIntent(
        goal ? { x: goal.x, y: goal.y, seat: isSeatAnchor(this.mapObjects, goal.x, goal.y) } : null,
        this.playerSeatGoal,
      );
    },
    // 그릴 것이 없으므로 붙고 떨어지는 알림은 무시한다.
    setPresentation: () => {},
  };

  private actors(): ActorSnapshot[] {
    const actors: ActorSnapshot[] = this.npcs.map((npc) => {
      const bubble = this.npcBubbles.get(npc.id);
      return {
        id: npc.id,
        name: npc.name,
        kind: "npc",
        x: npc.viewX,
        y: npc.viewY,
        direction: directionName(npc.direction),
        walking:
          !npc.ambientPaused &&
          (this.mayDriveNpc(npc)
            ? npc.actuallyWalking
            : (npc.remotePresentation?.walking ?? npc.remoteWalkingUntil > this.now)),
        appearance: npc.appearance,
        bubble:
          this.speechPreviews.get(npc.id, this.now) ||
          (bubble
            ? bubble.text || "···"
            : !this.responsePhases[npc.id] &&
                !this.activityBubbles.has(npc.id) &&
                !npc.calledForRoom &&
                !this.dialogOpen
              ? this.smalltalk.text(npc.id, this.now)
              : undefined),
        active: this.activityBubbles.has(npc.id),
        phase: this.responsePhases[npc.id],
        working: this.workingNpcs.has(npc.id),
        workingCount: this.workingCounts[npc.id] ?? 0,
      };
    });
    if (this.playerReady && this.player)
      actors.push({
        id: this.socket?.id || this.characterId || "local",
        userId:
          this.localPlayerIdentity?.socketId === this.socket?.id
            ? this.localPlayerIdentity?.userId
            : undefined,
        name: this.characterName,
        kind: "player",
        x: this.player.x,
        y: this.player.y,
        direction: directionName(this.currentDirection),
        walking: this.playerActuallyWalking,
        appearance: this.appearance,
        bubble: this.speechPreviews.get(this.socket?.id || this.characterId || "local", this.now),
      });
    for (const [id, remote] of this.remotePlayers)
      actors.push({
        id,
        userId: remote.userId,
        name: remote.name,
        kind: "remote",
        x: remote.x,
        y: remote.y,
        direction: remote.direction,
        walking: remote.animation !== "idle",
        appearance: remote.appearance,
        bubble: this.speechPreviews.get(remote.userId || id, this.now),
      });
    return actors;
  }

  // ===========================================================================
  // 부팅 — 옛 씬의 create()
  // ===========================================================================

  private boot(data: NonNullable<typeof pendingChannelData>): void {
    this.booted = true;
    this.setMotionConfig(data.motionConfig);
    // 소유자가 채널 설정에서 바꾸면 `channel:updated` 로 온다 — 다시 불러오지 않아도 바로 반영.
    this.eventScope.on("channel:motion-config", (config: unknown) => this.setMotionConfig(config));
    this.eventScope.on("meeting:request-entry", () => this.requestMeetingEntry());
    this.eventScope.on("meeting:cancel-entry", () => this.cancelMeetingEntry());
    this.eventScope.on("meeting:mode", (payload: { active: boolean }) =>
      this.setMeetingMode(payload.active),
    );
    this.meetingSpace = undefined;
    this.officeEnvironment = undefined;
    this.officeEnvironmentVersion = undefined;
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

    let tiledJsonData: Record<string, unknown> | null = null;
    let legacyMapData: unknown = null;
    this.channelId = data.channelId;
    this.mapRevision = data.mapRevision;

    const source = data.tiledJson ?? data.mapData;
    if (source) {
      const normalized = normalizeMeetingMap(source, data.mapConfig);
      this.meetingSpace = normalized.meetingSpace;
      if (data.tiledJson) data.tiledJson = normalized.mapData;
      else data.mapData = normalized.mapData;
    }

    if (data.tiledJson) {
      tiledJsonData = data.tiledJson as Record<string, unknown>;
    } else if (data.mapData) {
      // mapData 자체가 Tiled JSON 일 수 있다(tiledversion 필드).
      const mapData = data.mapData as Record<string, unknown>;
      if ("tiledversion" in mapData) tiledJsonData = mapData;
      else legacyMapData = mapData;
    }

    if (data.mapConfig) {
      const config = data.mapConfig as Record<string, unknown>;
      if (typeof config.spawnCol === "number") {
        this.tiledSpawnCol = config.spawnCol;
        this.mapConfigSpawnCol = config.spawnCol;
      }
      if (typeof config.spawnRow === "number") {
        this.tiledSpawnRow = config.spawnRow;
        this.mapConfigSpawnRow = config.spawnRow;
      }
    }

    const effectiveSpawn = effectiveMapSpawn(tiledJsonData, data.mapConfig);
    if (effectiveSpawn) {
      this.tiledSpawnCol = this.mapConfigSpawnCol = effectiveSpawn.col;
      this.tiledSpawnRow = this.mapConfigSpawnRow = effectiveSpawn.row;
    }

    if (data.savedPosition) this.savedPosition = data.savedPosition;

    setPendingChannelData(null); // 소비했다

    this.applyMapRuntime(
      tiledJsonData ? loadTiledRuntime(tiledJsonData) : loadLegacyRuntime(legacyMapData),
    );

    // 대화창
    this.eventScope.on("dialog:open", () => {
      this.dialogOpen = true;
    });
    this.eventScope.on("dialog:close", () => {
      this.dialogOpen = false;
    });
    // 보이는 방이 바뀌면, 그 방이 아닌 호출된 NPC 는 타이머 없이 바로 자리로 간다.
    this.eventScope.on("room:visible", (payload: { roomId: string | null }) => {
      this.visibleRoomId = payload.roomId;
      for (const npc of this.npcs) {
        if (!shouldReturnOnRoomChange(npc, payload.roomId)) continue;
        this.sendNpcHome(npc);
      }
    });

    // 배치 모드
    this.eventScope.on("placement-mode-start", (npc: { id: string }) => {
      this.placementNpcId = npc.id;
      this.placementMode = true;
      this.seatLabelCache = null;
    });
    this.eventScope.on("placement-mode-end", () => {
      this.placementMode = false;
      this.placementNpcId = null;
    });

    // 시작 위치 지정 모드
    this.eventScope.on("map-refresh-start", () => {
      this.paused = true;
    });
    this.eventScope.on("spawn-set-mode-start", () => {
      this.spawnSetMode = true;
    });
    this.eventScope.on("spawn-set-mode-end", () => {
      this.spawnSetMode = false;
    });
    this.eventScope.on("owner-status", (payload: { isOwner: boolean }) => {
      this.isChannelOwner = payload.isOwner;
    });

    // 로컬 NPC 추가/제거(자기 고용/해고)
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
        this.addNpc(npcData);
      },
    );
    this.eventScope.on("npc:remove-local", (payload: { npcId: string }) => {
      this.removeNpcById(payload.npcId);
    });
    this.eventScope.on(
      "npc:update-local",
      (payload: { npcId: string; name?: string; direction?: string; appearance?: unknown }) => {
        const npc = this.npcs.find((n) => n.id === payload.npcId);
        if (!npc) return;
        npc.updateFromData(payload);
      },
    );

    this.eventScope.on("npc:movement-owner", (payload: { npcId: string; ownerId: string }) => {
      this.takeNpcOwnership(payload.npcId, payload.ownerId);
    });

    this.eventScope.on(
      "npc:start-move",
      (payload: {
        npcId: string;
        targetCol: number;
        targetRow: number;
        destinationTag?: string;
        message?: string;
      }) => {
        const npc = this.npcs.find((n) => n.id === payload.npcId);
        if (!npc || !this.ensureLocalNpcOwnership(npc) || npc.moveState !== "idle") return;
        const destinationTag =
          typeof payload.destinationTag === "string" && payload.destinationTag.length > 0
            ? payload.destinationTag
            : undefined;
        if (
          !destinationTag &&
          this.ambientZones.some((zone) => zone.access !== undefined) &&
          !destinationTileAllowed(this.ambientZones, payload.targetCol, payload.targetRow)
        )
          return;
        this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
        const origin = {
          x: Math.floor(npc.pixelX / TILE_SIZE),
          y: Math.floor(npc.pixelY / TILE_SIZE),
        };
        const started = npc.moveTo(
          payload.targetCol,
          payload.targetRow,
          destinationTag ? this.npcPathfinder(npc, destinationTag, origin) : findPath,
          this.createNpcWalkValidator(),
          payload.message || destinationTag
            ? { message: payload.message, destinationTag }
            : undefined,
        );
        if (!started) this.npcTilePositions.add(`${npc.homeCol},${npc.homeRow}`);
      },
    );

    this.eventScope.on("npc:call-to-player", (payload: PendingNpcCall) =>
      this.handleNpcCallToPlayer(payload),
    );

    // NPC 응답이 끝났다 — 플레이어와 멀면 걸어가서 전한다
    this.eventScope.on("npc:deliver-response", (payload: { npcId: string; npcName: string }) => {
      if (!this.player) return;
      const npc = this.npcs.find((n) => n.id === payload.npcId);
      if (!npc) return;

      const dist = npc.distanceTo(this.player.x, this.player.y);
      if (dist < TILE_SIZE + 4) {
        // 이미 가깝다 — 말풍선만
        EventBus.emit("npc:bubble", { npcId: npc.id });
        return;
      }

      // 멀다 — 플레이어에게 간다(쉬고 있을 때만)
      if (!this.ensureLocalNpcOwnership(npc) || npc.moveState !== "idle") return;
      this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
      const playerCol = Math.floor(this.player.x / TILE_SIZE);
      const playerRow = Math.floor(this.player.y / TILE_SIZE);
      npc.moveTo(playerCol, playerRow, findPath, this.createNpcWalkValidator(), {
        message: `${payload.npcName}이(가) 대화를 원합니다`,
      });
    });

    this.eventScope.on("npc:start-return", (payload: { npcId: string }) => {
      if (!this.npcOwnership.startReturn(payload.npcId)) return;
      const npc = this.npcs.find((n) => n.id === payload.npcId);
      if (!npc || !this.mayDriveNpc(npc) || npc.moveState === "returning") return;
      npc.returnToHome(this.npcPathfinder(npc), this.createNpcWalkValidator());
      if (npc.moveState === "idle") this.finishNpcReturn(npc, true);
    });

    this.eventScope.on(
      "npc:approach-and-interact",
      (payload: { npcId: string; npcName?: string }) => {
        this.approachNpcAndInteract(payload.npcId, payload.npcName);
      },
    );

    // NPC 위치를 먼저 받아 스폰 충돌 검사를 맞춘 뒤, 플레이어를 세운다.
    void this.prefetchNpcPositions().then((npcs) => {
      if (this.disposed) return;
      this.loadNpcs(npcs);
      this.createPlayer();
    });

    // React 가 주는 소켓 — 플레이어 스폰 전후 어느 쪽이든 올 수 있다
    this.eventScope.on(
      "socket-ready",
      (payload: {
        socket: Socket;
        characterId: string;
        characterName: string;
        appearance: unknown;
      }) => {
        this.socket = payload.socket;
        this.characterId = payload.characterId;
        this.characterName = payload.characterName;
        this.appearance = payload.appearance;
        this.setupSocketListeners();

        if (this.playerReady && this.player) {
          this.joinMultiplayer(this.player.x, this.player.y);
        }
      },
    );

    this.responsePhases = {};
    this.eventScope.on(
      "npc:response-phases",
      (payload: { phases: Record<string, "queued" | "thinking" | "streaming"> }) => {
        this.responsePhases = payload.phases;
      },
    );
    // 작업 중 표시(R27) — GamePageClient 가 소켓의 `npc:working` 을 id 목록 + 건수로 접어 준다.
    this.workingNpcs = new Set();
    this.workingCounts = {};
    this.eventScope.on(
      "npc:working-state",
      (payload: { npcIds: string[]; counts?: Record<string, number> }) => {
        const previous = this.workingNpcs;
        this.workingNpcs = new Set(payload.npcIds);
        this.workingCounts = payload.counts ?? {};
        for (const npcId of this.workingNpcs) {
          if (!previous.has(npcId)) this.seatNpcForWork(npcId);
        }
      },
    );
    // 대화 미리보기는 활동·인사 수명과 무관하다.
    this.eventScope.on("chat:speech", (payload: { actorId: string; text: string }) => {
      this.speechPreviews.set(payload.actorId, payload.text, this.now);
    });
    // 말풍선. 원격 플레이어의 `chat:bubble` 은 렌더러가 직접 그린다.
    this.eventScope.on(
      "npc:bubble",
      (payload: { npcId: string; text?: string; durationMs?: number }) => {
        this.showNpcBubbleIcon(payload.npcId, payload.text, payload.durationMs);
      },
    );
    this.eventScope.on("npc:bubble-clear", (payload: { npcId: string }) => {
      this.clearNpcBubble(payload.npcId);
      this.activityBubbles.delete(payload.npcId);
    });
    // 작업 중 표시. "할 말 있음"(점 세 개) 말풍선과 자리는 같지만 뜻이 다르므로,
    // 활동으로 띄운 것만 따로 기억해 두었다가 활동이 끝날 때 그것만 지운다 —
    // 그러지 않으면 NPC 가 정말 할 말이 있어 띄운 말풍선까지 같이 사라진다.
    this.eventScope.on("npc:activity-bubble", (payload: { npcId: string; text?: string }) => {
      if (payload.text) {
        this.activityBubbles.add(payload.npcId);
        this.showNpcBubbleIcon(payload.npcId, payload.text);
        return;
      }
      if (this.activityBubbles.delete(payload.npcId)) {
        this.clearNpcBubble(payload.npcId);
      }
    });

    // 떠날 때 저장하려고 React 가 위치를 묻는다
    this.eventScope.on("request-player-position", () => {
      if (this.player) {
        EventBus.emit("player-position-response", { x: this.player.x, y: this.player.y });
      }
    });

    // React 에 준비됐다고 알린다
    EventBus.emit("scene-ready");
    EventBus.emit("three:bridge-ready", this.officeBridge);
  }

  private applyMapRuntime(runtime: MapRuntime): void {
    this.tiledMode = runtime.tiled;
    this.officeEnvironment = runtime.environment;
    this.officeEnvironmentVersion = runtime.environmentVersion;
    this.ambientZones = runtime.ambientZones;
    this.effectiveMapCols = runtime.cols;
    this.effectiveMapRows = runtime.rows;
    this.floorData = runtime.floor;
    this.wallsData = runtime.walls;
    this.collisionData = runtime.collision;
    this.mapObjects = runtime.objects;
    this.collisionCells = runtime.collisionCells;
    // Objects 레이어의 spawn 은 mapConfig 가 정하지 않았을 때만 쓴다
    if (this.mapConfigSpawnCol === null && runtime.tiledSpawn.col !== null)
      this.tiledSpawnCol = runtime.tiledSpawn.col;
    if (this.mapConfigSpawnRow === null && runtime.tiledSpawn.row !== null)
      this.tiledSpawnRow = runtime.tiledSpawn.row;
    this.refreshObjectOccupancy();
  }

  /** 오브젝트 목록이 바뀌면 점유 타일을 다시 만든다(옛 renderObjects 의 판정 부분). */
  private refreshObjectOccupancy(): void {
    this.objectOccupiedTiles = occupiedTiles({
      objects: this.mapObjects,
      collisionCells: this.collisionCells,
    });
  }

  // ===========================================================================
  // 걷기 판정 · 경로
  // ===========================================================================

  private isWalkable(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.effectiveMapCols || tileY < 0 || tileY >= this.effectiveMapRows)
      return false;
    // Tiled 맵의 collision 레이어
    if (this.collisionData.length > 0) {
      const collisionGid = this.collisionData[tileY]?.[tileX] ?? 0;
      if (collisionGid !== 0) return false;
    }
    // 레거시 벽
    if (this.wallsData.length > 0 && this.collisionData.length === 0) {
      const wallTile = this.wallsData[tileY]?.[tileX] ?? TILE_EMPTY;
      if (COLLISION_TILES.has(wallTile)) return false;
    }
    // 오브젝트 점유 타일
    if (this.objectOccupiedTiles.has(`${tileX},${tileY}`)) return false;
    return true;
  }

  private trafficActors(): TrafficActor[] {
    const point = (x: number, y: number) => ({ x: x / TILE_SIZE - 0.5, y: y / TILE_SIZE - 0.5 });
    return [
      ...this.npcs.map((npc) => ({ id: npc.id, ...point(npc.pixelX, npc.pixelY) })),
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
          this.delta,
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

  private npcPathfinder(
    npc: NpcController,
    destinationTag = npc.destinationTag ?? undefined,
    purposeAccessOrigin = npc.purposeAccessOrigin ?? undefined,
  ): NpcPathfinder {
    return (sx, sy, ex, ey, walkable) => {
      const actors = this.trafficActors().filter((actor) => actor.id !== npc.id);
      if (destinationTag)
        return findTaggedDestinationPath(
          this.ambientZones,
          destinationTag,
          { x: sx, y: sy },
          { x: ex, y: ey },
          walkable,
          (from, to) => clearActors(from, to, actors),
          purposeAccessOrigin ?? { x: sx, y: sy },
        );
      return findTrafficPath(sx, sy, ex, ey, walkable, actors);
    };
  }

  private createNpcWalkValidator(): (tx: number, ty: number) => boolean {
    // 거친 경로는 정적 지형만 본다; 지나가는 액터는 교통 조정이 스윕 디스크로 다룬다.
    return (tx, ty) => this.isWalkable(tx, ty);
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

  /** NPC·원격 플레이어·미리 받은 NPC 자리가 그 타일에 있는가 */
  private isTileOccupied(col: number, row: number): boolean {
    // 컨트롤러가 생기기 전에도 미리 받은 NPC 자리는 안다
    if (this.npcTilePositions.has(`${col},${row}`)) return true;

    return !clearActors(
      { x: col, y: row },
      { x: col, y: row },
      this.trafficActors().filter((actor) => actor.id !== "player:local"),
    );
  }

  /** 원하는 타일 근처의 빈 스폰 위치 */
  private findFreeSpawn(preferCol: number, preferRow: number): { col: number; row: number } {
    if (this.isWalkable(preferCol, preferRow) && !this.isTileOccupied(preferCol, preferRow)) {
      return { col: preferCol, row: preferRow };
    }
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
    return { col: preferCol, row: preferRow }; // 폴백
  }

  private canPlaceAt(col: number, row: number): boolean {
    return (
      isDeskSeatAnchor(this.mapObjects, col, row) &&
      this.isWalkable(col, row) &&
      !this.npcs.some((n) => n.id !== this.placementNpcId && n.homeCol === col && n.homeRow === row)
    );
  }

  // ===========================================================================
  // 회의
  // ===========================================================================

  /** 도착 사건만 UI의 회의 참여를 허용한다. 요청 자체는 참가 등록을 하지 않는다. */
  isInMeetingSpace(): boolean {
    return (
      !!this.player &&
      !!this.meetingSpace &&
      insideMeetingSpace(this.meetingSpace.bounds, this.player.x / 32, this.player.y / 32)
    );
  }

  requestMeetingEntry(): boolean {
    if (this.meetingEntryPending) return false;
    if (!this.player || !this.canMovePlayer() || !this.meetingSpace) {
      EventBus.emit("meeting:entry-state", { status: "failed", reasonCode: "map_unavailable" });
      return false;
    }
    if (insideMeetingSpace(this.meetingSpace.bounds, this.player.x / 32, this.player.y / 32)) {
      this.currentPath = null;
      this.traffic.clear("player:local");
      EventBus.emit("meeting:entry-state", { status: "arrived" });
      return true;
    }
    const target = this.meetingSpace.entry;
    const path = this.findPlayerPath(
      Math.floor(this.player.x / 32),
      Math.floor(this.player.y / 32),
      Math.floor(target.x),
      Math.floor(target.y),
    );
    if (!path?.length) {
      EventBus.emit("meeting:entry-state", { status: "failed", reasonCode: "path_unavailable" });
      return false;
    }
    this.meetingEntryPending = true;
    this.meetingEntryStartedAt = this.now;
    this.currentPath = path;
    this.meetingEntryPath = path;
    this.pathIndex = 0;
    this.pathLastDist = Infinity;
    this.pathStuckTimer = 0;
    this.targetNpcId = null;
    EventBus.emit("meeting:entry-state", { status: "walking" });
    return true;
  }

  cancelMeetingEntry(): void {
    if (!this.meetingEntryPending) return;
    this.meetingEntryPending = false;
    if (this.currentPath === this.meetingEntryPath) this.currentPath = null;
    this.meetingEntryPath = null;
    EventBus.emit("meeting:entry-state", { status: "cancelled" });
  }

  setMeetingMode(active: boolean): void {
    this.meetingMode = active;
    if (active && !this.meetingSeatTarget) this.currentPath = null;
    if (!active && this.meetingSeatTarget) {
      this.currentPath = null;
      this.meetingSeatTarget = null;
    }
  }

  // ===========================================================================
  // NPC 이동 권위 · 스냅샷 적용
  // ===========================================================================

  /**
   * 걷던 중에 서버가 도착을 확정했다(`STALLED_MOTION_MS` — 탭이 가려져 걸음이 멈춘 경우).
   * 이 탭이 구동자라 평소엔 스냅샷 좌표를 받지 않지만, 남은 걸음을 버리고 확정된 자리로 옮긴다.
   * 스스로 도착한 경우에는 좌표가 같아 보이는 변화가 없다.
   */
  private snapToAuthority(npc: NpcController, state: MotionNpc): void {
    npc.pixelX = state.x;
    npc.pixelY = state.y;
    npc.direction = directionFromName(state.direction);
    npc.syncView();
    npc.remotePresentation?.accept(state.x, state.y, true);
    this.traffic.clear(npc.id);
  }

  private applySpatialNpc(npc: NpcController, state: MotionNpc): void {
    const target = state.spatialTarget!;
    if (state.ownerSocketId !== this.socket?.id) {
      this.spatialNpcRoutes.delete(npc.id);
      return;
    }
    if (!state.moving) {
      if (npc.moveState !== "waiting") this.snapToAuthority(npc, state);
      npc.cancelMovement();
      npc.moveState = "waiting";
      return;
    }
    const route = this.spatialNpcRoutes.get(npc.id);
    if (route?.generation === target.generation) return;
    this.spatialNpcRoutes.set(npc.id, { generation: target.generation, done: false });
    npc.cancelMovement();
    npc.destinationTag = null;
    npc.purposeAccessOrigin = null;
    npc.ambientExitPolicy = null;
    const path = this.npcPathfinder(npc)(
      Math.floor(npc.pixelX / 32),
      Math.floor(npc.pixelY / 32),
      Math.floor(target.x / 32),
      Math.floor(target.y / 32),
      this.createNpcWalkValidator(),
    );
    if (!path?.length) {
      this.socket?.emit("npc:spatial-failed", {
        channelId: this.channelId,
        npcId: npc.id,
        generation: target.generation,
      });
      return;
    }
    path[path.length - 1] = { x: target.x / 32 - 0.5, y: target.y / 32 - 0.5 };
    // 회의 호출. 전에는 산책 경로를 그대로 써서 산책 속도(55px/s)로 모였다 — 부르면 뛰어온다.
    npc.startStroll(path, this.motion.meetingSummon);
  }

  private updateSpatialNpc(npc: NpcController, state: MotionNpc): void {
    const target = state.spatialTarget!;
    if (state.ownerSocketId !== this.socket?.id || !state.moving) return;
    this.applySpatialNpc(npc, state);
    const route = this.spatialNpcRoutes.get(npc.id);
    if (!route || route.done) return;
    const result = npc.updateMovement(
      this.delta,
      this.player!.x,
      this.player!.y,
      this.npcPathfinder(npc),
      this.createNpcWalkValidator(),
      (position, goal, amount) =>
        this.traffic.step(
          npc.id,
          position,
          goal,
          amount,
          this.now,
          (x, y) => this.isWalkable(x, y),
          this.trafficActors(),
        ),
    );
    if (Math.hypot(npc.pixelX - target.x, npc.pixelY - target.y) <= 2) {
      route.done = true;
      npc.cancelMovement();
      npc.moveState = "waiting";
      this.socket?.emit("npc:position-update", {
        channelId: this.channelId,
        npcId: npc.id,
        x: npc.pixelX,
        y: npc.pixelY,
        direction: directionName(npc.direction),
      });
      this.socket?.emit("npc:arrived", {
        channelId: this.channelId,
        npcId: npc.id,
        generation: target.generation,
      });
    } else if (result === "idle" && npc.moveState === "idle") {
      route.done = true;
      this.socket?.emit("npc:spatial-failed", {
        channelId: this.channelId,
        npcId: npc.id,
        generation: target.generation,
      });
    }
  }

  private applyMotionNpc(npc: NpcController, state: MotionNpc, force = false): void {
    if (adoptNpcMotionHome(npc, state)) {
      force = true;
      this.seatLabelCache = null; // 점유 표시는 자리(home)를 따른다
    }
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
      // 권위 재설정이 경로를 취소했으므로 같은 공간 이동 세대도 다시 계획한다.
      this.spatialNpcRoutes.delete(npc.id);
      npc.pixelX = state.x;
      npc.pixelY = state.y;
      npc.direction = directionFromName(state.direction);
      npc.syncView();
      npc.remotePresentation.accept(state.x, state.y, true);
      this.traffic.clear(npc.id);
    } else if (!localDriver) {
      // 권위 충돌 좌표는 지금 갱신하고, 표시는 프레임마다 따라온다.
      npc.pixelX = state.x;
      npc.pixelY = state.y;
      npc.direction = directionFromName(state.direction);
      npc.remotePresentation.accept(state.x, state.y);
    }
    npc.remoteWalkingUntil = !localDriver && state.moving ? this.now + 500 : 0;
    if (state.spatialTarget) {
      this.applySpatialNpc(npc, state);
      return;
    }
    this.spatialNpcRoutes.delete(npc.id);
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
      this.snapToAuthority(npc, state);
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

  private restoreMotionNpc(npc: NpcController): void {
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
        // 만료된 캐시 좌석이 복원된 아바타 아래에 있을 수 있다. 예약 없이 앉아 있는 것처럼
        // 보이지 않도록 빈 바닥 타일로 옮긴다.
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
                this.player.x = (x + 0.5) * TILE_SIZE;
                this.player.y = (y + 0.5) * TILE_SIZE;
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
    for (const npc of this.npcs) {
      if (npc.motionLocallyDriven !== false || !npc.remotePresentation) continue;
      const view = npc.remotePresentation;
      view.step(this.delta);
      npc.viewX = view.x;
      npc.viewY = view.y;
    }
  }

  private npcContinuation(npc: NpcController) {
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
            // 같은 Socket 객체가 재연결 뒤 더 새로운 예약을 이미 가질 수 있다.
            // 낡은 예약은 서버의 출발/접근 임대 정리가 맡는다.
            return;
          }
          this.pendingSeatClaims.delete(actorId);
          done(!error && !!result?.ok);
        },
      );
  }

  private releaseSeat(actorId: string): void {
    this.socket?.emit("seat:release", { channelId: this.channelId, actorId });
  }

  private isAmbientLeader(): boolean {
    return (
      !!this.socket?.connected &&
      this.peerSnapshotReady &&
      !!this.motionSnapshot.current &&
      this.motionSnapshot.current.ambientLeaderId === this.socket.id
    );
  }

  private mayDriveNpc(npc: NpcController): boolean {
    return (
      !!this.socket?.connected &&
      this.peerSnapshotReady &&
      !!this.motionSnapshot.current &&
      this.npcOwnership.mayDrive(npc.id, this.socket.id, this.isAmbientLeader())
    );
  }

  private takeNpcOwnership(npcId: string, ownerId: string): void {
    if (!this.npcOwnership.claim(npcId, ownerId)) return;
    const npc = this.npcs.find((entry) => entry.id === npcId);
    if (npc) {
      npc.cancelMovement();
      npc.calledForRoom = null;
      delete npc.ambientSchedule.seatTarget;
      delete npc.ambientSchedule.seatRest;
      this.traffic.clear(npcId);
    }
  }

  private ensureLocalNpcOwnership(npc: NpcController, reason?: string, roomId?: string) {
    if (!this.socket?.connected || !this.socket.id || !this.motionSnapshot.current) return false;
    if (this.npcOwnership.owner(npc.id) === this.socket.id) return true;
    // 소유권을 낙관적으로 먼저 잡는다 — 걸음이 한 틱도 끊기지 않게 하려는 것이다.
    // 그래서 **거절되면 반드시 되돌린다.** 예전에는 ack 조차 받지 않아 서버가 거절해도
    // 클라이언트만 자기가 주인이라고 믿었고, 그 뒤로는 호출을 다시 보내지도 않았다.
    const previousOwner = this.npcOwnership.owner(npc.id);
    this.takeNpcOwnership(npc.id, this.socket.id);
    const npcId = npc.id;
    this.socket.emit(
      "npc:call",
      {
        channelId: this.channelId,
        npcId,
        ...(reason ? { reason } : {}),
        ...(roomId ? { roomId } : {}),
      },
      (result: unknown) => {
        if (this.disposed || !isNpcCallRejected(result)) return;
        if (previousOwner) this.npcOwnership.claim(npcId, previousOwner);
        else this.npcOwnership.clear(npcId);
        EventBus.emit("toast:show", {
          messageKey: npcCallErrorKey((result as { error?: unknown })?.error),
        });
      },
    );
    return true;
  }

  private finishNpcReturn(npc: NpcController, publish: boolean): void {
    const position = { x: npc.pixelX, y: npc.pixelY };
    const home = { x: (npc.homeCol + 0.5) * TILE_SIZE, y: (npc.homeRow + 0.5) * TILE_SIZE };
    if (publish)
      publishNpcArrival((event, payload) => this.socket?.emit(event, payload), {
        channelId: this.channelId,
        npcId: npc.id,
        ...position,
        direction: directionName(npc.direction),
      });
    if (this.npcOwnership.finishReturn(npc.id, position, home)) {
      npc.ambientSchedule = createAmbientSchedule();
      npc.calledForRoom = null;
      npc.remoteWalkingUntil = 0;
      this.traffic.clear(npc.id);
      EventBus.emit("npc:movement-returned", { npcId: npc.id });
    }
  }

  private releaseNpcOwner(ownerId: string): void {
    for (const npcId of this.npcOwnership.releaseOwner(ownerId)) {
      const npc = this.npcs.find((entry) => entry.id === npcId);
      if (!npc) continue;
      npc.cancelMovement();
      npc.calledForRoom = null;
      npc.ambientSchedule = { ...createAmbientSchedule(), phase: "home" };
      this.traffic.clear(npcId);
      EventBus.emit("npc:movement-returned", { npcId });
    }
  }

  private handleNpcCallToPlayer(payload: PendingNpcCall): void {
    if (
      !this.player ||
      !this.motionSnapshot.current ||
      !this.npcs.some((npc) => npc.id === payload.npcId)
    ) {
      this.pendingNpcCalls.set(payload.npcId, payload);
      return;
    }
    const playerCol = Math.floor(this.player.x / TILE_SIZE);
    const playerRow = Math.floor(this.player.y / TILE_SIZE);
    const npc = this.npcs.find((n) => n.id === payload.npcId);
    if (!npc) return;
    if (!this.ensureLocalNpcOwnership(npc, payload.reason, payload.roomId)) return;
    if (npc.moveState !== "idle") return;
    npc.calledForRoom = payload.reason === "map-chat" ? (payload.roomId ?? null) : null;

    // B-1. 업무 중인 직원도 **막지 않고** 부른다 — 실행은 Hermes 워커가 하므로 자리를 떠나도
    // 카드는 계속 돈다. 다만 방해했는지 모른 채로 두지는 않는다. 개수까지 말하는 이유는
    // 한 직원이 여러 장을 돌릴 수 있어서다(프로필별 상한은 기본 무제한).
    const busyCount = this.workingCounts[npc.id] ?? 0;
    if (busyCount > 0)
      EventBus.emit("toast:show", {
        messageKey: "game.calledWhileWorking",
        params: { name: payload.npcName || npc.name, count: String(busyCount) },
      });

    const dist = npc.distanceTo(this.player.x, this.player.y);
    if (dist < TILE_SIZE + 4) {
      npc.pendingMessage = payload.message || null;
      npc.arrivalBubbleText = payload.bubbleText || null;
      npc.waitDurationMs = 10000;
      npc.moveState = "waiting";
      npc.waitTimer = 0;
      if (!npc.calledForRoom)
        EventBus.emit("npc:bubble", {
          npcId: npc.id,
          text: npc.arrivalBubbleText || undefined,
        });
      EventBus.emit("toast:show", {
        messageKey: "game.pressToTalk",
        params: { name: payload.npcName || npc.name },
      });
      EventBus.emit("npc:movement-arrived", {
        npcId: npc.id,
        npcName: payload.npcName || npc.name,
        pendingMessage: npc.pendingMessage,
      });
      publishNpcArrival((event, data) => this.socket?.emit(event, data), {
        channelId: this.channelId,
        npcId: npc.id,
        x: npc.pixelX,
        y: npc.pixelY,
        direction: directionName(npc.direction),
      });
      return;
    }

    this.npcTilePositions.delete(`${npc.homeCol},${npc.homeRow}`);
    npc.moveTo(playerCol, playerRow, findPath, this.createNpcWalkValidator(), {
      message: payload.message,
      bubbleText: payload.bubbleText,
      // 호출 — 부르면 뛰어온다(기본은 평소 걸음의 2배).
      speed: this.motion.summon,
    });
  }

  // ===========================================================================
  // 포인터 · 키보드
  // ===========================================================================

  private handlePointerDown(
    worldX: number,
    worldY: number,
    button: number,
    screenX: number,
    screenY: number,
  ): void {
    const rightButtonDown = button === 2;
    // 배치 모드: 찍은 타일에 NPC 를 둔다
    if (this.placementMode) {
      const col = Math.floor(worldX / TILE_SIZE);
      const row = Math.floor(worldY / TILE_SIZE);
      if (this.canPlaceAt(col, row)) EventBus.emit("placement-complete", { col, row });
      return;
    }

    // 시작 위치 지정 모드
    if (this.spawnSetMode) {
      const col = Math.floor(worldX / TILE_SIZE);
      const row = Math.floor(worldY / TILE_SIZE);
      if (this.isWalkable(col, row)) EventBus.emit("spawn:selected", { col, row });
      return;
    }

    if (!this.player || !this.playerReady || !this.canMovePlayer()) return;
    if (this.meetingMode) return;
    this.cancelMeetingEntry();

    // NPC 우클릭: 컨텍스트 메뉴
    if (rightButtonDown) {
      for (const npc of this.npcs) {
        if (
          matchesNpcTarget(
            { id: npc.id, x: npc.pixelX, y: npc.pixelY },
            { x: worldX, y: worldY, actorId: this.presentationActorId },
          )
        ) {
          EventBus.emit("npc:context-menu", {
            npcId: npc.id,
            npcName: npc.name,
            screenX,
            screenY,
            moveState: npc.moveState,
          });
          return;
        }
      }
      return;
    }

    const targetTileX = Math.floor(worldX / TILE_SIZE);
    const targetTileY = Math.floor(worldY / TILE_SIZE);

    let clickedNpc: NpcController | null = null;
    for (const npc of this.npcs) {
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
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
    if (CAPTURED_KEYS.has(event.key) || event.code === "Slash") event.preventDefault();
    const key = event.code === "Slash" ? "Slash" : event.key;
    if (!this.keysDown.has(key)) this.justPressed.add(key);
    this.keysDown.add(key);
    if (event.key === "Escape") {
      if (this.placementMode) EventBus.emit("placement-cancel");
      if (this.spawnSetMode) EventBus.emit("spawn-set-cancel");
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code === "Slash" ? "Slash" : event.key);
  };

  private handleWindowBlur = (): void => {
    this.keysDown.clear();
    this.justPressed.clear();
  };

  private isKeyDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  // ===========================================================================
  // NPC 로딩
  // ===========================================================================

  /** 컨트롤러를 만들기 전에 NPC 자리를 먼저 받아 스폰 충돌 검사가 맞게 한다 */
  private async prefetchNpcPositions(): Promise<NpcData[]> {
    // 실패는 빈 목록과 구분해서 알린다. 예전에는 채널 없이 `/api/npcs` 를 부르고
    // 응답 상태를 보지 않아, 400 이 조용히 "NPC 0명" 으로 그려졌다.
    const result = await fetchChannelNpcs(this.channelId);
    if (!result.ok) {
      console.warn(
        `[OfficeSimulation] prefetchNpcPositions failed (${result.reason}):`,
        result.message,
      );
      return [];
    }
    const npcs = result.npcs as NpcData[];
    for (const npc of npcs) {
      this.npcTilePositions.add(`${npc.positionX},${npc.positionY}`);
    }
    return npcs;
  }

  /** 채널 걸음 설정을 받는다. 믿지 않고 접으므로 비었거나 틀린 값이면 기본값이다. */
  setMotionConfig(config: unknown): void {
    this.motion = normalizeNpcMotionConfig(config);
    for (const npc of this.npcs) this.applyMotion(npc);
  }

  /** 위치 보고 간격(ms). 가장 빠르게 움직이는 NPC 가 한 번에 30px 를 넘지 않게 한다. */
  private npcPositionSyncInterval(): number {
    let fastest = 0;
    for (const npc of this.npcs)
      if (npc.moveState !== "idle" && npc.moveState !== "waiting")
        fastest = Math.max(fastest, npc.currentSpeed());
    if (fastest <= 0) return NPC_SYNC_MAX_INTERVAL_MS;
    return Math.min(
      NPC_SYNC_MAX_INTERVAL_MS,
      Math.max(NPC_SYNC_MIN_INTERVAL_MS, (NPC_SYNC_CHORD_PX / fastest) * 1000),
    );
  }

  private applyMotion(npc: NpcController): void {
    npc.moveSpeed = this.motion.walk;
    npc.strollSpeed = this.motion.stroll;
  }

  private loadNpcs(npcDataList: NpcData[]): void {
    for (const npc of npcDataList) this.addNpc(npc);
  }

  private addNpc(data: NpcData): void {
    if (this.npcs.some((n) => n.id === data.id)) return;
    const npc = new NpcController(data);
    this.applyMotion(npc);
    this.npcs.push(npc);
    this.seatLabelCache = null;
    this.restoreMotionNpc(npc);
    this.npcTilePositions.add(`${data.positionX},${data.positionY}`);
  }

  private removeNpcById(npcId: string): void {
    this.npcOwnership.clear(npcId);
    this.spatialNpcRoutes.delete(npcId);
    const idx = this.npcs.findIndex((n) => n.id === npcId);
    if (idx === -1) return;
    const npc = this.npcs[idx];
    const col = Math.floor(npc.pixelX / TILE_SIZE);
    const row = Math.floor(npc.pixelY / TILE_SIZE);
    this.npcTilePositions.delete(`${col},${row}`);
    this.npcs.splice(idx, 1);
    this.seatLabelCache = null;
    // 말풍선은 컨트롤러가 아니라 npcId 로 든 맵에 있다. 여기서 지우지 않으면
    // 퇴근에도, npc:removed 에도 마지막 자리에 영구히 남는다.
    this.clearNpcBubble(npcId);
    this.activityBubbles.delete(npcId);
  }

  // ===========================================================================
  // 소켓 리스너
  // ===========================================================================

  private handleSocketDisconnect = (): void => {
    this.localPlayerIdentity = undefined;
    this.cancelMeetingEntry();
    this.spatialNpcRoutes.clear();
    this.rejoin.onDisconnect();
    this.motionSnapshot.clear();
    this.peerSnapshotReady = false;
    this.playerSpawnReady = false;
    this.pendingPlayerResume = null;
    this.resumingPlayerGoal = null;
    this.motionGeneration++;
    this.pendingSeatClaims.clear();
  };

  private handleSocketConnect = (): void => {
    const reconnect = this.rejoin.shouldRejoin(this.playerReady && !!this.player);
    if (this.playerReady && this.player && (reconnect || this.joinedSocketId !== this.socket?.id)) {
      this.joinMultiplayer(this.player.x, this.player.y);
    }
  };

  // 이 경로는 connect 트래커와 경쟁한다: 재연결 시 socket.io-client 가 버퍼링된
  // chat:send 를 유저 connect 리스너보다 먼저 플러시해, 서버의 chat:error not_joined 가
  // connect 핸들러의 join 뒤에 도착할 수 있다. 소켓 id 로 중복을 걸러낸다
  // (src/game/socket-rejoin.ts 의 shouldRejoinForError 주석 참조).
  private handleSocketRejoin = (): void => {
    if (!this.playerReady || !this.player) return;
    if (!shouldRejoinForError(this.socket?.id, this.joinedSocketId)) return;
    this.joinMultiplayer(this.player.x, this.player.y);
  };

  /** 회의 상태의 참가자 목록에서 내 socket ↔ user 를 배운다. 끊긴 소켓은 배우지 않는다. */
  private handleMeetingState(
    socket: Socket,
    state: { participants?: Array<{ id: string; userId?: string }> },
  ): void {
    if (this.socket !== socket || !socket.connected || !socket.id) return;
    const local = state.participants?.find((participant) => participant.id === socket.id);
    this.localPlayerIdentity =
      typeof local?.userId === "string" && local.userId
        ? { socketId: socket.id, userId: local.userId }
        : undefined;
  }

  private handleMotionState(snapshot: MotionSnapshot): void {
    const first = !this.motionSnapshot.current;
    const becameLeader =
      this.motionSnapshot.current?.ambientLeaderId !== this.socket?.id &&
      snapshot.ambientLeaderId === this.socket?.id;
    if (!this.motionSnapshot.accept(snapshot, this.channelId)) return;
    const ownSeat = snapshot.seats.find((seat) => seat.actorId === this.socket?.id);
    if (ownSeat?.spatial && this.player && this.meetingSeatTarget !== ownSeat.seatId) {
      this.meetingSeatTarget = ownSeat.seatId;
      this.playerSeatGoal = ownSeat.seatId.startsWith("standing:") ? null : ownSeat.seatId;
      const path = this.findPlayerPath(
        Math.floor(this.player.x / 32),
        Math.floor(this.player.y / 32),
        Math.floor(ownSeat.x / 32),
        Math.floor(ownSeat.y / 32),
      );
      if (path?.length) {
        this.currentPath = path;
        this.pathIndex = 0;
        this.pathLastDist = Infinity;
        this.pathStuckTimer = 0;
      } else
        EventBus.emit("meeting:entry-state", {
          status: "failed",
          reasonCode: "path_unavailable",
        });
    }
    if (first && ownSeat) this.playerSeatGoal = ownSeat.seatId;
    if (
      this.playerSeatGoal &&
      !snapshot.seats.some(
        (seat) => seat.seatId === this.playerSeatGoal && seat.actorId === this.socket?.id,
      )
    )
      this.playerSeatGoal = null;
    this.resumePlayerGoal();
    for (const npc of this.npcs) {
      const state = snapshot.npcs.find((entry) => entry.npcId === npc.id);
      if (state) this.applyMotionNpc(npc, state, restoreOnSnapshot(first, becameLeader, state));
      const pending = this.pendingNpcCalls.get(npc.id);
      if (pending && this.player) {
        this.pendingNpcCalls.delete(npc.id);
        EventBus.emit("npc:call-to-player", pending);
      }
    }
  }

  /** 권위 스폰. 아직 입력이 없었던 아바타만 서버 위치로 옮기고, 이동 목표 복원을 예약한다. */
  private handlePlayerSpawn(position: PlayerSpawnState): void {
    if (this.player && untouchedSpawn(this.spawnRequest, this.player, this.spawnInputStarted)) {
      this.player.x = position.x;
      this.player.y = position.y;
      this.currentDirection = directionFromName(position.direction);
      this.playerActuallyWalking = false;
      this.currentPath = null;
      this.traffic.clear("player:local");
      // 기억된 좌석은 의도일 뿐, 살아 있는 예약의 증거가 아니다.
      this.playerSeatGoal = null;
      this.pendingPlayerResume = position.motion ?? null;
    }
    // 권위 스냅샷을 소비한 뒤에야 로컬 프레임이 이동을 내보낼 수 있다.
    this.spawnRequest = null;
    this.playerSpawnReady = true;
    this.lastSentMotion = "";
    this.resumePlayerGoal();
  }

  /**
   * 옛 위치 패킷. 새 스냅샷이 이미 실어 나르는 NPC 에는 손대지 않는다 — 같은 좌표의 중복
   * 패킷이 표시를 끊거나 걷기 플래그를 지우면 안 된다.
   */
  private handleLegacyPositionSync(data: {
    npcId: string;
    x: number;
    y: number;
    direction: string;
  }): void {
    const npc = this.npcs.find((n) => n.id === data.npcId);
    if (
      !npc ||
      this.motionSnapshot.current?.npcs.some((entry) => entry.npcId === data.npcId) ||
      this.mayDriveNpc(npc)
    )
      return;
    const moved = Math.hypot(npc.pixelX - data.x, npc.pixelY - data.y) > 0.01;
    npc.remoteWalkingUntil = moved ? this.now + 500 : 0;
    npc.direction = directionFromName(data.direction);
    npc.setPosition(data.x, data.y);
  }

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
    // setupSocketListeners() 는 정상 흐름에서 두 번 불린다 — 부팅의 request-socket →
    // socket-ready 1차, createPlayer() 의 player-spawned → ThreeGame 이 같은 소켓으로
    // socket-ready 를 재발행하는 2차. off-then-on 으로 멱등하게 만들어, 재조인 1회에
    // player:join 이 두 번 나가지 않게 한다 (핸들러는 인스턴스 필드라 참조가 안정적이다).
    this.socket.off("disconnect", this.handleSocketDisconnect);
    listen("disconnect", this.handleSocketDisconnect);
    this.socket.off("connect", this.handleSocketConnect);
    listen("connect", this.handleSocketConnect);
    listen("meeting:state", (state: { participants?: Array<{ id: string; userId?: string }> }) =>
      this.handleMeetingState(socket, state),
    );
    registerOnce(EventBus, "socket-rejoin", this.handleSocketRejoin);

    listen("npc:motion-state", (snapshot: MotionSnapshot) => this.handleMotionState(snapshot));
    listen("player:spawn", (position: PlayerSpawnState) => this.handlePlayerSpawn(position));
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
      for (const id of [...this.remotePlayers.keys()]) {
        if (!this.connectedPlayerIds.has(id)) this.remotePlayers.delete(id);
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
        this.remotePlayers
          .get(data.id)
          ?.updatePosition(data.x, data.y, data.direction, data.animation);
      },
    );

    listen("player:left", (data: { id: string }) => {
      this.connectedPlayerIds.delete(data.id);
      this.peerPositions.delete(data.id);
      this.peerMotionSamples.delete(data.id);
      this.releaseNpcOwner(data.id);
      this.remotePlayers.delete(data.id);
    });

    // NPC 실시간 동기화
    listen("npc:added", (npcData: NpcData) => this.addNpc(npcData));

    // 두 가지 모양이 온다 — 옛 `{ npcId, … }`(외형·방향 편집)와 새 `{ npc }`(출근부
    // 토글). 판단은 `decideNpcUpdate` 가 한다(node 에서 테스트되는 순수 함수).
    listen("npc:updated", (data: NpcUpdatedPayload) => {
      const action = decideNpcUpdate(data, (id) => this.npcs.some((n) => n.id === id));
      if (action.kind === "ignore") return;
      if (action.kind === "remove") {
        this.removeNpcById(action.npcId);
        return;
      }
      if (action.kind === "update") {
        const npc = this.npcs.find((n) => n.id === action.npcId);
        if (!npc) return;
        npc.updateFromData(action.fields);
        const motion = this.motionSnapshot.current?.npcs.find((state) => state.npcId === npc.id);
        if (motion) this.applyMotionNpc(npc, motion);
        return;
      }
      this.addNpc({ ...action.npc });
    });

    listen("npc:removed", (data: { npcId: string }) => {
      this.removeNpcById(data.npcId);
    });

    // 맵 편집 실시간 동기화(레거시 맵)
    listen("map:object-added", (data: { object: MapObject }) => {
      this.mapObjects.push(data.object);
      this.refreshObjectOccupancy();
    });

    listen("map:object-removed", (data: { objectId: string }) => {
      this.mapObjects = this.mapObjects.filter((o) => o.id !== data.objectId);
      this.refreshObjectOccupancy();
    });

    listen(
      "map:tiles-updated",
      (data: { layer: string; row: number; col: number; tileId: number }) => {
        if (this.tiledMode) return; // Tiled JSON 맵은 레거시 타일 편집을 쓰지 않는다
        if (data.layer === "floor" && this.floorData[data.row]) {
          this.floorData[data.row][data.col] = data.tileId;
        } else if (data.layer === "walls" && this.wallsData[data.row]) {
          this.wallsData[data.row][data.col] = data.tileId;
        }
      },
    );

    listen("npc:stop-moving", (data: { npcId: string }) => {
      const npc = this.npcs.find((n) => n.id === data.npcId);
      if (!npc) return;
      npc.remoteWalkingUntil = 0;
      this.finishNpcReturn(npc, false);
    });

    listen(
      "npc:position-sync",
      (data: { npcId: string; x: number; y: number; direction: string }) =>
        this.handleLegacyPositionSync(data),
    );
  }

  // ===========================================================================
  // 원격 플레이어 · 로컬 플레이어
  // ===========================================================================

  private addRemotePlayer(data: RemotePlayerData): void {
    if (this.remotePlayers.has(data.id)) return;
    if (!this.connectedPlayerIds.has(data.id)) return;
    this.remotePlayers.set(
      data.id,
      new RemotePlayer({ ...data, ...this.peerPositions.get(data.id) }),
    );
  }

  private createPlayer(): void {
    if (this.playerReady) return; // 중복 생성 방지

    let spawnX: number;
    let spawnY: number;

    // 기존 멤버는 떠난 자리에서 이어 간다; 설정된 스폰은 첫 방문용이다.
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
      // NPC·원격 플레이어·오브젝트 점유 타일을 모두 피한 빈 자리를 찾는다
      const preferSpawnCol = this.tiledSpawnCol ?? 8;
      const preferSpawnRow = this.tiledSpawnRow ?? 3;
      const { col: spawnCol, row: spawnRow } = this.findFreeSpawn(preferSpawnCol, preferSpawnRow);
      spawnX = spawnCol * TILE_SIZE + TILE_SIZE / 2;
      spawnY = spawnRow * TILE_SIZE + TILE_SIZE / 2;
    }

    this.player = { x: spawnX, y: spawnY };
    this.currentDirection = DIR_DOWN;
    this.playerReady = true;
    EventBus.emit("player-spawned");

    this.joinMultiplayer(spawnX, spawnY);
  }

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
    // 이름·외형은 서버가 내 캐릭터 행에서 채운다 — 보내지 않는다(characterId 는 대조용).
    this.socket.emit("player:join", {
      characterId: this.characterId,
      mapId: this.channelId || "office",
      mapRevision: this.mapRevision,
      x,
      y,
    });
    this.joinedSocketId = this.socket.id;
  }

  /** 위치 전송(스로틀). 두 권위 스냅샷이 모두 온 뒤에만 내보낸다. */
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

  /** 검사를 통과한 끝점을 그대로 확정한다. 움직였는지 돌려준다. */
  private commitPlayerStep(to: { x: number; y: number }): boolean {
    const player = this.player!;
    const moved = player.x !== to.x || player.y !== to.y;
    player.x = to.x;
    player.y = to.y;
    return moved;
  }

  // ===========================================================================
  // 말풍선
  // ===========================================================================

  private showNpcBubbleIcon(npcId: string, text?: string, durationMs?: number): void {
    if (this.npcBubbles.has(npcId)) {
      if (durationMs || !text) return;
      this.clearNpcBubble(npcId);
    }

    const npc = this.npcs.find((n) => n.id === npcId);
    if (!npc) return;

    const bubble = { text };
    this.npcBubbles.set(npcId, bubble);
    if (durationMs)
      this.scheduler.delay(this.now, durationMs, () => {
        // 옛 인사가 더 새로운 작업/보고 말풍선을 지우면 안 된다.
        if (this.npcBubbles.get(npcId) === bubble) this.clearNpcBubble(npcId);
      });
  }

  private clearNpcBubble(npcId: string): void {
    this.npcBubbles.delete(npcId);
  }

  // ===========================================================================
  // NPC 근접
  // ===========================================================================

  private checkNpcProximity(): void {
    if (!this.playerReady || !this.player) return;
    const player = this.player;

    const nearby: NpcController[] = [];
    for (const npc of this.npcs) {
      if (npc.distanceTo(player.x, player.y) < NPC_INTERACT_RADIUS) nearby.push(npc);
    }
    nearby.sort((a, b) => a.distanceTo(player.x, player.y) - b.distanceTo(player.x, player.y));
    this.nearbyNpcs = nearby;

    // 처음 다가갈 때 자동 인사
    for (const npc of nearby) {
      if (!this.greetedNpcs.has(npc.id) && !this.dialogOpen && npc.moveState === "idle") {
        this.greetedNpcs.add(npc.id);
        EventBus.emit("npc:auto-greet", { npcId: npc.id, npcName: npc.name });
      }
    }

    // 근처 원격 플레이어
    const nearbyP: { id: string; name: string }[] = [];
    for (const [id, remote] of this.remotePlayers) {
      if (remote.distanceTo(player.x, player.y) < NPC_INTERACT_RADIUS) {
        nearbyP.push({ id, name: remote.name });
      }
    }
    this.nearbyPlayers = nearbyP;

    const hasNearby = nearby.length > 0 || nearbyP.length > 0;

    // NPC 대화창: 근처에 아무도 없으면 자동으로 닫는다
    // 단, NPC 가 플레이어에게 오는 중(응답 전달)이면 닫지 않는다
    const npcApproaching = this.npcs.some((n) => n.moveState === "moving-to-player");
    if (
      this.dialogOpen &&
      nearby.length === 0 &&
      this.nearbyPlayers.length === 0 &&
      !npcApproaching
    ) {
      EventBus.emit("npc:dialog-auto-close");
    }

    // 채널 채팅: 대화 대상 근접 여부로 입력 활성/비활성을 알린다.
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

  private approachNpcAndInteract(npcId: string, npcName?: string): void {
    if (!this.player || !this.playerReady || !this.canMovePlayer()) return;

    const npc = this.npcs.find((entry) => entry.id === npcId);
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
  }

  // ===========================================================================
  // 틱
  // ===========================================================================

  /** 대기 중인 NPC 를 자리로 보낸다 — 타이머 만료와 채널 채팅 닫힘이 같은 경로를 쓴다. */
  /**
   * 카드가 돌기 시작한 직원을 **자기 지정석으로 돌려보낸다**(설계 2026-09-21 npc-working-state, C-1).
   *
   * 임자는 `mayDriveNpc` 가 정한다 — 소유자가 나이거나, 소유자가 없고 내가 앰비언트 리더일 때만
   * 움직인다. 이 판정을 빼면 접속한 모두가 같은 NPC 를 따로 걷게 하고, 반대로 너무 좁히면
   * 아무도 걷지 않는다(`src/game/AGENTS.md` 의 이동 소유권 불변식).
   *
   * 부름을 받아 와 있거나(`calledForRoom`) 이미 움직이는 중이면 건드리지 않는다 — 사용자가
   * 부른 것이 자동 착석보다 우선이다. 좌석 점유는 `sendNpcHome` 이 타는 서버 경로가 정본이라
   * 여기서 좌석을 직접 잡지 않는다.
   */
  private seatNpcForWork(npcId: string): void {
    const npc = this.npcs.find((entry) => entry.id === npcId);
    if (!npc) return;
    if (npc.calledForRoom || npc.moveState !== "idle") return;
    if (!this.mayDriveNpc(npc)) return;
    const atHome =
      Math.floor(npc.pixelX / TILE_SIZE) === npc.homeCol &&
      Math.floor(npc.pixelY / TILE_SIZE) === npc.homeRow;
    if (atHome) return;
    this.sendNpcHome(npc);
  }

  private sendNpcHome(npc: NpcController): void {
    if (!this.mayDriveNpc(npc)) return;
    if (this.motionSnapshot.current?.npcs.some((s) => s.npcId === npc.id && s.spatialTarget))
      return;
    npc.waitTimer = 0;
    this.clearNpcBubble(npc.id);
    this.npcOwnership.startReturn(npc.id);
    this.socket?.emit("npc:return-home", { channelId: this.channelId, npcId: npc.id });
    npc.returnToHome(this.npcPathfinder(npc), this.createNpcWalkValidator());
    if (npc.moveState === "idle") this.finishNpcReturn(npc, true);
  }

  private publishReturnDiagnostics(): void {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.NEXT_PUBLIC_DESKRPG_MOTION_DIAGNOSTICS !== "1" ||
      this.now - this.returnDiagnosticAt < 1000
    )
      return;
    this.returnDiagnosticAt = this.now;
    const states = this.npcs
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
    }
    this.returnDiagnosticNode.textContent = JSON.stringify(states);
  }

  private step(now: number, delta: number): void {
    if (this.disposed || !this.booted) return;
    this.now = now;
    this.delta = delta;
    this.scheduler.tick(now);
    if (this.paused) {
      this.justPressed.clear();
      return;
    }
    this.update();
    this.justPressed.clear();
  }

  /** 프레임 갱신. 옛 씬의 update() 와 같은 순서다. */
  private update(): void {
    this.playerActuallyWalking = false;
    if (this.meetingEntryPending && this.currentPath !== this.meetingEntryPath)
      this.cancelMeetingEntry();
    if (this.meetingEntryPending && this.now - this.meetingEntryStartedAt > 120_000) {
      this.cancelMeetingEntry();
      EventBus.emit("meeting:entry-state", { status: "failed", reasonCode: "arrival_timeout" });
    }
    this.publishReturnDiagnostics();
    // 원격 플레이어는 매 프레임 보간한다
    for (const remote of this.remotePlayers.values()) remote.lerpUpdate();

    this.updateRemoteNpcPresentation();

    // 원격 스냅샷은 계속 오지만, 로컬 입력은 권위 하이드레이션과 경쟁할 수 없다.
    if (!this.canMovePlayer()) return;
    if (this.player) this.updateNpcs();

    // 배치 모드: 플레이어 이동을 건너뛴다(강조 표시는 렌더러 커서가 맡는다)
    if (this.placementMode) return;
    // 시작 위치 지정 모드: 마찬가지
    if (this.spawnSetMode) return;

    if (!this.playerReady || !this.player) return;

    this.checkNpcProximity();

    // `/` 키로 NPC/플레이어와 상호작용
    if (this.justPressed.has("Slash")) {
      if (isTypingTarget(document.activeElement)) return;
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

    this.updatePlayer();
  }

  private updateNpcs(): void {
    const player = this.player!;
    const leader = this.isAmbientLeader();
    this.smalltalk.update(
      this.npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        x: npc.pixelX / TILE_SIZE,
        y: npc.pixelY / TILE_SIZE,
        walking: npc.moveState === "strolling" || npc.remoteWalkingUntil > this.now,
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
      this.now,
      (a, b) => {
        // 벽이나 책장 줄 너머로 인사하지 않는다.
        for (let step = 1; step < 8; step++) {
          const x = Math.floor(a.x + ((b.x - a.x) * step) / 8);
          const y = Math.floor(a.y + ((b.y - a.y) * step) / 8);
          if (!this.isWalkable(x, y)) return false;
        }
        return true;
      },
    );
    for (const npc of this.npcs) {
      const partnerId = this.smalltalk.partner(npc.id, this.now);
      const partner = this.npcs.find((other) => other.id === partnerId);
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
            direction: directionName(npc.direction),
          });
          this.socket?.emit("npc:arrived", { channelId: this.channelId, npcId: npc.id });
        }
      }
      npc.ambientPaused = paused;
    }
    // 가장 오래 준비된 사람이 다음 출발 자리를 받는다.
    const ambientOrder = [...this.npcs].sort(
      (a, b) =>
        b.ambientSchedule.elapsed -
        b.ambientSchedule.duration -
        (a.ambientSchedule.elapsed - a.ambientSchedule.duration),
    );
    for (const npc of ambientOrder) {
      if (this.motionSnapshot.current?.npcs.some((s) => s.npcId === npc.id && s.spatialTarget))
        continue;
      const allowed =
        this.npcOwnership.mayRoam(npc.id, leader) &&
        ambientAllowed(
          // 일하는 중이면 산책을 나가지 않는다. 활동 말풍선만으로는 부족하다 — 조용히 오래 도는
          // 실행에서는 `tool.progress` 가 없어, 앰비언트 일정(rest 60~100초)이 차는 순간
          // 배지를 단 채 자리에서 일어난다(결정 C-1 "실행이 시작되면 자리로 가서 앉는다").
          this.workingNpcs.has(npc.id) ||
            !!this.responsePhases[npc.id] ||
            this.activityBubbles.has(npc.id),
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
        // 걷던 중에 일이 시작된 직원은 여기서 멈춘다. `seatNpcForWork` 는 `moveState !== "idle"`
        // 이면 돌아서므로, 멈춘 자리에 배지만 단 채 서 있지 않도록 이 자리에서 다시 보낸다.
        // 이 분기는 일하는 동안 매 틱 도니 아직 idle 이 아니어도 다음 틱에 다시 시도한다.
        if (this.workingNpcs.has(npc.id)) this.seatNpcForWork(npc.id);
        continue;
      }
      if (npc.ambientPaused) continue;
      if (npc.moveState !== "idle" && npc.moveState !== "strolling") continue;
      if (npc.remoteWalkingUntil > this.now) continue;
      const sx = Math.floor(npc.pixelX / TILE_SIZE),
        sy = Math.floor(npc.pixelY / TILE_SIZE);
      if (!npc.ambientSeat) {
        // 저장된 배치가 권위 있는 자리다 — 다른 의자를 고르지 않는다.
        npc.ambientSeat = { x: npc.homeCol, y: npc.homeRow };
        // 첫 도착도 주기를 시작하기 전에 근무 자리를 확정한다.
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
          this.delta,
        )
      )
        continue;
      const previousPhase = npc.ambientSchedule.phase;
      advanceAmbientSchedule(
        npc.ambientSchedule,
        this.delta,
        atHome,
        Math.random,
        this.ambientDepartures.canDepart(
          this.now,
          this.npcs.filter((other) => other !== npc && other.ambientSchedule.phase !== "rest")
            .length,
        ),
      );
      if (previousPhase === "rest" && npc.ambientSchedule.phase !== "rest") {
        this.ambientDepartures.departed(this.now);
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
      if (this.npcs.filter((other) => other !== npc && other.moveState === "strolling").length >= 2)
        continue;
      npc.ambientTimer += Math.min(this.delta, 100);
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
            !this.npcs.some(
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
        // 방/방석 순서가 방문마다 치우치지 않게 좌석을 따로 섞는다.
        for (let i = publicSeats.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [publicSeats[i], publicSeats[j]] = [publicSeats[j], publicSeats[i]];
        }
        destinations.unshift(...publicSeats);
      }
      // 한 번에 하는 A* 를 제한한다; 이 무작위 묶음이 닿지 않으면 나중에 다시 시도한다.
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
                  this.npcs.filter((other) => other !== npc && other.moveState === "strolling")
                    .length < 2 &&
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
    // 대화창 없이 충분히 기다린 NPC 는 자동으로 돌아간다
    for (const npc of this.npcs) {
      if (
        this.mayDriveNpc(npc) &&
        shouldAutoReturn(npc, {
          dialogOpen: this.dialogOpen,
          visibleRoomId: this.visibleRoomId,
        })
      ) {
        npc.waitTimer += this.delta;
        if (
          npc.waitTimer >= npc.waitDurationMs &&
          !this.motionSnapshot.current?.npcs.some((s) => s.npcId === npc.id && s.spatialTarget)
        )
          this.sendNpcHome(npc);
      }
    }

    for (const npc of this.npcs) {
      if (!this.mayDriveNpc(npc)) continue;
      const spatialMotion = this.motionSnapshot.current?.npcs.find(
        (s) => s.npcId === npc.id && s.spatialTarget,
      );
      if (spatialMotion) {
        this.updateSpatialNpc(npc, spatialMotion);
        continue;
      }
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
        (!npc.destinationTag ||
          !npc.purposeAccessOrigin ||
          taggedPathTileAllowed(
            this.ambientZones,
            npc.destinationTag,
            npc.purposeAccessOrigin,
            x,
            y,
          )) &&
        (!wasStrolling || npc.ambientSchedule.phase === "home" || zoneWalkable(x, y));
      const result = npc.updateMovement(
        this.delta,
        player.x,
        player.y,
        this.npcPathfinder(npc),
        routeWalkable,
        (bodyPosition, goal, amount) => {
          const zoneWalkableNow =
            npc.ambientExitPolicy?.at(bodyPosition) ??
            ((x: number, y: number) => ambientTileAllowed(this.ambientZones, x, y));
          return this.traffic.step(
            npc.id,
            bodyPosition,
            goal,
            amount,
            this.now,
            (x, y) =>
              this.isWalkable(x, y) &&
              (!npc.destinationTag ||
                !npc.purposeAccessOrigin ||
                taggedPathTileAllowed(
                  this.ambientZones,
                  npc.destinationTag,
                  npc.purposeAccessOrigin,
                  x,
                  y,
                )) &&
              (!wasStrolling || npc.ambientSchedule.phase === "home" || zoneWalkableNow(x, y)),
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
          direction: directionName(npc.direction),
        });
        this.socket?.emit("npc:arrived", { channelId: this.channelId, npcId: npc.id });
      }
      if (result === "arrived") {
        if (!npc.calledForRoom)
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
        });
        publishNpcArrival((event, payload) => this.socket?.emit(event, payload), {
          channelId: this.channelId,
          npcId: npc.id,
          x: npc.pixelX,
          y: npc.pixelY,
          direction: directionName(npc.direction),
        });
      } else if (result === "returning-done") {
        this.npcTilePositions.add(`${npc.homeCol},${npc.homeRow}`);
        this.finishNpcReturn(npc, true);
      }
    }

    // 쉬는 시계·멈춤 시계도 보존한다; 위치 갱신만으로는 멈춰 있는 상태를 놓친다.
    this.npcContinuationTimer += this.delta;
    if (this.npcContinuationTimer >= 1000) {
      this.npcContinuationTimer = 0;
      for (const npc of this.npcs) {
        if (this.mayDriveNpc(npc))
          this.socket?.emit("npc:continuation-update", {
            channelId: this.channelId,
            npcId: npc.id,
            continuation: this.npcContinuation(npc),
          });
      }
    }
    // 움직이는 NPC 위치를 서버에 보낸다. 간격은 **한 번에 움직이는 거리**로 정한다 — 서버는
    // 연속한 두 보고 사이의 직선이 막히지 않았는지 검사하는데, 빠르게 걸으면 그 직선이 모퉁이·가구를
    // 가로지른다. 한 번 거절되면 서버 위치가 뒤처져 다음 직선은 더 길어지고 영영 받아들여지지 않는다
    // (실측: 200ms 고정일 때 회의 호출 150px/s 는 집결했고 300px/s 는 "이동 중" 에서 멈췄다). 옛
    // 걸음(150px/s)이 200ms 에 가던 30px 를 넘지 않게 속도에 맞춰 간격을 줄인다.
    this.npcPositionSyncTimer += this.delta;
    if (this.npcPositionSyncTimer >= this.npcPositionSyncInterval()) {
      this.npcPositionSyncTimer = 0;
      for (const npc of this.npcs) {
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
            direction: directionName(npc.direction),
          });
        }
      }
    }
  }

  private updatePlayer(): void {
    const player = this.player!;
    // 키보드 입력
    const left = !this.meetingMode && this.isKeyDown("ArrowLeft");
    const right = !this.meetingMode && this.isKeyDown("ArrowRight");
    const up = !this.meetingMode && this.isKeyDown("ArrowUp");
    const down = !this.meetingMode && this.isKeyDown("ArrowDown");
    const hasKeyboardInput = left || right || up || down;
    if (hasKeyboardInput) {
      this.cancelMeetingEntry();
      this.spawnInputStarted = true;
      if (this.playerSeatGoal) {
        this.releaseSeat(this.socket?.id ?? "");
        this.playerSeatGoal = null;
      }
    }

    // 화살표 키는 경로 추종을 취소한다
    if (hasKeyboardInput && this.currentPath) {
      this.traffic.clear("player:local");
      this.currentPath = null;
      this.targetNpcId = null;
    }

    // 좌석에 다가가기 전에 예약한다; 겹쳐 서서는 경합이 풀리지 않는다.
    if (this.currentPath?.length && this.socket?.id) {
      const goal = this.currentPath[this.currentPath.length - 1];
      const goalId = `${(goal.x + 0.5) * TILE_SIZE}:${(goal.y + 0.5) * TILE_SIZE}`;
      if (this.playerSeatGoal && this.playerSeatGoal !== goalId) {
        this.releaseSeat(this.socket.id);
        this.playerSeatGoal = null;
      }
      if (isSeatAnchor(this.mapObjects, goal.x, goal.y) && this.playerSeatGoal !== goalId) {
        const path = this.currentPath;
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
              else this.currentPath = null;
            },
          );
        return;
      }
    }
    // 경로 추종
    if (this.currentPath && this.pathIndex < this.currentPath.length) {
      const target = this.currentPath[this.pathIndex];
      const targetPixelX = target.x * TILE_SIZE + TILE_SIZE / 2;
      const targetPixelY = target.y * TILE_SIZE + TILE_SIZE / 2;

      const dx = targetPixelX - player.x;
      const dy = targetPixelY - player.y;
      const dist = Math.hypot(dx, dy);

      if (dist < this.pathLastDist - 0.5) {
        this.pathStuckTimer = 0;
        this.pathLastDist = dist;
      } else {
        this.pathStuckTimer++;
      }

      // 좌석은 보통 목적지와 달리 중심까지 가야 한다.
      const arrivingAtSeat =
        this.pathIndex === this.currentPath.length - 1 &&
        isSeatAnchor(this.mapObjects, target.x, target.y);
      if (arrivingAtSeat && this.isTileOccupied(target.x, target.y)) {
        this.releaseSeat(this.socket?.id ?? "");
        this.playerSeatGoal = null;
        this.currentPath = null;
        return;
      }
      const reached = dist < 2;
      if (reached) {
        this.pathIndex++;
        this.pathStuckTimer = 0;
        this.pathLastDist = Infinity;
        if (this.pathIndex >= this.currentPath.length) {
          if (this.meetingEntryPending && this.currentPath === this.meetingEntryPath) {
            this.meetingEntryPending = false;
            this.meetingEntryPath = null;
            this.sendPosition(player.x, player.y, directionName(this.currentDirection), "idle");
            EventBus.emit("meeting:entry-state", { status: "arrived" });
          }
          this.currentPath = null;
          this.traffic.clear("player:local");

          if (this.targetNpcId) {
            const npc = this.npcs.find((n) => n.id === this.targetNpcId);
            if (npc) EventBus.emit("npc:interact", { npcId: npc.id, npcName: npc.name });
            this.targetNpcId = null;
          }
        }
      } else {
        const dt = Math.max(0.001, Math.min(this.delta, 100) / 1000);
        const next = this.traffic.step(
          "player:local",
          { x: player.x / TILE_SIZE - 0.5, y: player.y / TILE_SIZE - 0.5 },
          target,
          Math.min(PLAYER_SPEED * dt, dist) / TILE_SIZE,
          this.now,
          (x, y) => this.isWalkable(x, y),
          this.trafficActors(),
        );
        const vx = ((next.x + 0.5) * TILE_SIZE - player.x) / dt;
        const vy = ((next.y + 0.5) * TILE_SIZE - player.y) / dt;
        this.playerActuallyWalking = this.commitPlayerStep({
          x: (next.x + 0.5) * TILE_SIZE,
          y: (next.y + 0.5) * TILE_SIZE,
        });

        if (Math.abs(vx) > Math.abs(vy)) {
          this.currentDirection = vx > 0 ? DIR_RIGHT : DIR_LEFT;
        } else if (vy !== 0) {
          this.currentDirection = vy > 0 ? DIR_DOWN : DIR_UP;
        }
      }

      this.sendPosition(
        player.x,
        player.y,
        directionName(this.currentDirection),
        this.playerActuallyWalking ? "walk" : "idle",
      );
      return;
    }

    // 수동 충돌 검사(레이어 콜라이더가 없다)
    if (hasKeyboardInput) {
      const currentTileX = Math.floor(player.x / TILE_SIZE);
      const currentTileY = Math.floor(player.y / TILE_SIZE);

      let vx = 0;
      let vy = 0;

      // 가로 이동(걸을 수 있고 NPC/플레이어가 없는지)
      if (left) {
        const checkX = Math.floor((player.x - 12) / TILE_SIZE);
        if (this.isWalkable(checkX, currentTileY)) vx = -PLAYER_SPEED;
      } else if (right) {
        const checkX = Math.floor((player.x + 12) / TILE_SIZE);
        if (this.isWalkable(checkX, currentTileY)) vx = PLAYER_SPEED;
      }

      // 세로 이동
      if (up) {
        const checkY = Math.floor((player.y - 12) / TILE_SIZE);
        if (this.isWalkable(currentTileX, checkY)) vy = -PLAYER_SPEED;
      } else if (down) {
        const checkY = Math.floor((player.y + 12) / TILE_SIZE);
        if (this.isWalkable(currentTileX, checkY)) vy = PLAYER_SPEED;
      }

      if (vx !== 0 && vy !== 0) {
        const factor = Math.SQRT1_2;
        vx *= factor;
        vy *= factor;
      }

      const dt = Math.min(this.delta, 100) / 1000;
      if (
        !clearMovementSegment(
          { x: player.x / TILE_SIZE - 0.5, y: player.y / TILE_SIZE - 0.5 },
          {
            x: (player.x + vx * dt) / TILE_SIZE - 0.5,
            y: (player.y + vy * dt) / TILE_SIZE - 0.5,
          },
          (x, y) => this.isWalkable(x, y),
        ) ||
        !clearActors(
          { x: player.x / TILE_SIZE - 0.5, y: player.y / TILE_SIZE - 0.5 },
          {
            x: (player.x + vx * dt) / TILE_SIZE - 0.5,
            y: (player.y + vy * dt) / TILE_SIZE - 0.5,
          },
          this.trafficActors().filter((actor) => actor.id !== "player:local"),
        )
      ) {
        vx = 0;
        vy = 0;
      }
      this.playerActuallyWalking = this.commitPlayerStep({
        x: player.x + vx * dt,
        y: player.y + vy * dt,
      });

      if (vx !== 0 || vy !== 0) {
        if (Math.abs(vx) >= Math.abs(vy)) {
          this.currentDirection = vx < 0 ? DIR_LEFT : DIR_RIGHT;
        } else {
          this.currentDirection = vy < 0 ? DIR_UP : DIR_DOWN;
        }
        this.sendPosition(player.x, player.y, directionName(this.currentDirection), "walk");
      } else {
        this.sendPosition(player.x, player.y, directionName(this.currentDirection), "idle");
      }
    } else {
      this.sendPosition(player.x, player.y, directionName(this.currentDirection), "idle");
    }
  }
}
