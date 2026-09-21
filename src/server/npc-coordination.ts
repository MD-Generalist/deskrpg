import type { Server, Socket } from "socket.io";
import { parseMotionContinuation, type MotionContinuation } from "./npc-motion-continuation";
import type { MeetingSpatialTarget, SpatialMotionTarget } from "../lib/meeting-discussion-state";
import { insideMeetingSpace, type MeetingSpace } from "../game/meeting-space";
import { clearSegment, findPath } from "../game/navigation";
import { NPC_SPEED_RANGE } from "../lib/npc-motion-config";

export type NpcMotionPhase = "idle" | "called" | "waiting" | "returning" | "ambient";
export type NpcMotion = {
  npcId: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  direction: string;
  ownerSocketId: string | null;
  phase: NpcMotionPhase;
  moving: boolean;
  revision: number;
  continuation?: MotionContinuation | null;
  spatialTarget?: SpatialMotionTarget | null;
};
export type CoordinationChannel = {
  sanitizedHomes?: boolean;
  npcs: { id: string; x: number; y: number }[];
  seats: { id: string; x: number; y: number }[];
  bounds?: { width: number; height: number };
  meetingSpace?: MeetingSpace;
  canStandAt?: (point: { x: number; y: number }) => boolean;
  isWalkable?: (x: number, y: number) => boolean;
};
export type CoordinationDependencies = {
  getPlayer(
    socketId: string,
  ): { mapId: string; x?: number; y?: number; userId?: string; characterId?: string } | undefined;
  loadChannel(channelId: string): Promise<CoordinationChannel>;
  now?: () => number;
  onSpatialArrival?: (channelId: string, actorId: string, generation: number) => void;
  onSpatialBlocked?: (
    channelId: string,
    actorId: string,
    reason: string,
    generation: number,
  ) => void;
  onSpatialPlayerArrival?: (channelId: string, userId: string, socketId: string) => void;
  onSpatialPlayerBlocked?: (channelId: string, userId: string) => void;
};
type Reservation = {
  seatId: string;
  actorId: string;
  ownerSocketId: string;
  x: number;
  y: number;
  arrived: boolean;
  expires: number;
  spatial?: boolean;
};
type Channel = {
  source: Promise<Channel>;
  channelId: string;
  identities: Map<string, string>;
  disconnected: Map<
    string,
    { identity: string; expires: number; timer: ReturnType<typeof setTimeout> }
  >;
  data: CoordinationChannel;
  npcs: Map<string, NpcMotion>;
  reservations: Map<string, Reservation>;
  players: Map<string, { x: number; y: number }>;
  revision: number;
  excursions: Set<string>;
  ambientLeaderId: string | null;
};
type Ack = (result: { ok: boolean; error?: string; revision?: number; seatId?: string }) => void;
export const NPC_RECONNECT_GRACE_MS = 30_000;
export const NPC_IDLE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_IDLE_NPC_CHANNELS = 256;
/**
 * 소유된 이동(호출·회의 이동)이 이만큼 아무 진척도 보고하지 않으면 서버가 도착으로 확정한다.
 *
 * 걸음은 브라우저 한 탭의 rAF 가 구동한다. 탭이 가려지면 브라우저가 rAF 를 멈추는데, 연결은
 * 살아 있으므로 "구동자 없음" 정산은 불리지 않고 호출·회의 집결이 "이동 중" 에서 굳었다
 * (스테이징 실측). 걷는 중이면 초당 여러 번 위치가 오므로 10초 침묵은 걸음이 멈췄다는 뜻이다.
 */
export const STALLED_MOTION_MS = 10_000;
const STALL_SWEEP_INTERVAL_MS = 2_000;
const directions = new Set(["up", "down", "left", "right"]);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
/**
 * 사람이 자기 예약 좌석에 도착했는가. 이동 핸들러의 도착 통지와 회의 집결의 "이미 앉아 있다"
 * 판정이 **같은 규칙**을 써야 한다 — 둘이 갈리면 한쪽에서는 도착, 다른 쪽에서는 이동 중이 된다.
 */
const PLAYER_ARRIVAL_RADIUS = 2;
const atReservationPoint = (
  reservation: { x: number; y: number },
  position: { x: number; y: number },
) => distance(reservation, position) <= PLAYER_ARRIVAL_RADIUS;

/** Process-local authority. DB homes and seat anchors are inputs; no pathfinding or AI calls. */
export function createNpcCoordination(io: Server, dependencies: CoordinationDependencies) {
  const channels = new Map<string, Promise<Channel>>();
  // Keep the revision watermark across reset: fresh geometry must outrank any
  // snapshot clients received before the refresh.
  const revisions = new Map<string, number>();
  const nextRevision = (id: string) => {
    const revision = (revisions.get(id) ?? -1) + 1;
    revisions.set(id, revision);
    return revision;
  };
  const isCurrent = (state: Channel) => channels.get(state.channelId) === state.source;
  const now = dependencies.now ?? Date.now;
  const spatialLastMotion = new Map<string, number>();
  const spatialMotionCredit = new Map<string, number>();
  const validatedPlayers = new Map<string, { x: number; y: number }>();
  // 서버가 받아들이는 NPC 이동 상한(px/s). 캡처 런타임은 걸음이 빨라 상한도 같이 올린다
  // — 클라이언트의 `captureWalkSpeed` 와 짝이다.
  //
  // 전에는 180 으로 고정이었다 — 걸음이 150 하나뿐일 때 그 1.2배였다. 걸음 속도가 채널 설정이
  // 되자 회의 호출 기본값(300)이 이 상한을 넘어 서버가 좌석 이동을 거절했고, 집결이 "이동 중"
  // 에서 영영 멈췄다(로컬 실측: 150 은 정상, 300 은 멈춤). 상한을 채널마다 설정에서 읽지 않고
  // **설정할 수 있는 최고 속도의 1.2배**로 둔다 — DB 읽기·설정 변경 때의 캐시 무효화 없이 어느
  // 채널 설정도 막지 않는다. 순간이동 방지(아래 누적 크레딧)는 그대로다.
  // 캡처 배수 3 은 `npc-controller.ts` 의 `CAPTURE_WALK_MULTIPLIER` 다. 그 모듈을 서버로 끌어오지
  // 않으려고 숫자로 둔다(원래도 그랬다).
  const NPC_SPEED_CAP =
    NPC_SPEED_RANGE.max * 1.2 * (process.env.DESKRPG_CAPTURE_MODE === "1" ? 3 : 1);
  const consumeMotion = (key: string, separation: number, speed: number) => {
    const elapsed = Math.max(0, (now() - (spatialLastMotion.get(key) ?? now())) / 1000);
    const credit = Math.min(speed, (spatialMotionCredit.get(key) ?? 8) + elapsed * speed);
    spatialLastMotion.set(key, now());
    if (separation > credit) {
      spatialMotionCredit.set(key, credit);
      return false;
    }
    spatialMotionCredit.set(key, credit - separation);
    return true;
  };
  const inactive = new Map<
    string,
    { startedAt: number; expires: number; timer: ReturnType<typeof setTimeout> }
  >();
  const identity = (socketId: string, channelId: string) => {
    const player = dependencies.getPlayer(socketId);
    return player?.userId && player.characterId
      ? JSON.stringify([player.userId, player.characterId, channelId])
      : undefined;
  };
  const cancelInactive = (channelId: string) => {
    const entry = inactive.get(channelId);
    if (entry) clearTimeout(entry.timer);
    inactive.delete(channelId);
  };
  const evict = (channelId: string) => {
    cancelInactive(channelId);
    // 새 맵에는 이전 위치 검증과 이동 예산을 재사용하지 않는다.
    for (const cache of [validatedPlayers, spatialLastMotion, spatialMotionCredit])
      for (const key of cache.keys()) if (key.startsWith(`${channelId}:`)) cache.delete(key);
    const pending = channels.get(channelId);
    channels.delete(channelId);
    void pending
      ?.then((state) => {
        for (const departure of state.disconnected.values()) clearTimeout(departure.timer);
      })
      .catch(() => {});
  };
  const retainInactive = (channelId: string) => {
    if (inactive.has(channelId)) return;
    const expires = now() + NPC_IDLE_RETENTION_MS;
    const timer = setTimeout(() => {
      if (inactive.get(channelId)?.expires === expires && !members(channelId).length)
        evict(channelId);
    }, NPC_IDLE_RETENTION_MS);
    timer.unref();
    inactive.set(channelId, { startedAt: now(), expires, timer });
    while (inactive.size > MAX_IDLE_NPC_CHANNELS) evict(inactive.keys().next().value!);
  };
  const member = (socket: Socket, channelId: unknown): channelId is string =>
    typeof channelId === "string" &&
    dependencies.getPlayer(socket.id)?.mapId === channelId &&
    socket.rooms.has(channelId);
  const members = (channelId: string, exclude?: string) =>
    [...(io.sockets.adapter.rooms.get(channelId) ?? [])]
      .filter(
        (id) =>
          id !== exclude &&
          dependencies.getPlayer(id)?.mapId === channelId &&
          io.sockets.sockets.get(id)?.connected,
      )
      .sort();
  const leader = (channelId: string, exclude?: string) => members(channelId, exclude)[0] ?? null;
  const create = (
    data: CoordinationChannel,
    channelId: string,
    source: Promise<Channel>,
  ): Channel => {
    const revision = nextRevision(channelId);
    return {
      channelId,
      source,
      identities: new Map(),
      disconnected: new Map(),
      data,
      revision,
      excursions: new Set(),
      ambientLeaderId: null,
      reservations: new Map(),
      players: new Map(),
      npcs: new Map(
        data.npcs.map((npc) => [
          npc.id,
          {
            npcId: npc.id,
            x: npc.x,
            y: npc.y,
            homeX: npc.x,
            homeY: npc.y,
            direction: "down",
            ownerSocketId: null,
            phase: "idle",
            moving: false,
            revision,
          },
        ]),
      ),
    };
  };
  const load = (channelId: string) => {
    if ((inactive.get(channelId)?.expires ?? Infinity) <= now()) evict(channelId);
    let pending = channels.get(channelId);
    if (!pending) {
      const replacement: Promise<Channel> = dependencies.loadChannel(channelId).then((data) => {
        if (channels.get(channelId) !== replacement) throw Error("Stale channel load");
        return create(data, channelId, replacement);
      });
      pending = replacement;
      channels.set(channelId, pending);
      void pending.catch(() => {
        if (channels.get(channelId) === pending) channels.delete(channelId);
      });
    }
    return pending;
  };
  const prune = (state: Channel) => {
    for (const [socketId, departure] of state.disconnected) {
      if (departure.expires > now()) continue;
      clearTimeout(departure.timer);
      state.disconnected.delete(socketId);
      state.identities.delete(socketId);
      for (const [seatId, reservation] of state.reservations) {
        if (
          reservation.ownerSocketId === socketId &&
          !reservation.spatial &&
          state.npcs.get(reservation.actorId)?.phase !== "ambient"
        ) {
          state.reservations.delete(seatId);
          state.revision = nextRevision(state.channelId);
        }
      }
      for (const npc of state.npcs.values()) {
        if (npc.ownerSocketId !== socketId) continue;
        if (npc.spatialTarget) {
          const heir = leader(state.channelId);
          if (heir) {
            npc.ownerSocketId = heir;
            npc.moving = true;
            changed(state, npc);
          } else settleDriverlessSpatial(state, npc, state.channelId);
          continue;
        }
        npc.ownerSocketId = leader(state.channelId);
        npc.phase = "returning";
        npc.continuation = null;
        npc.moving = !!npc.ownerSocketId;
        state.revision = nextRevision(state.channelId);
        npc.revision = state.revision;
      }
    }
    if (inactive.has(state.channelId)) return;
    for (const [id, reservation] of state.reservations)
      if (!reservation.spatial && !reservation.arrived && reservation.expires <= now()) {
        state.reservations.delete(id);
        state.revision = nextRevision(state.channelId);
        const npc = state.npcs.get(reservation.actorId);
        if (
          npc?.phase === "ambient" &&
          !npc.moving &&
          distance(npc, { x: npc.homeX, y: npc.homeY }) <= 2
        ) {
          state.excursions.delete(npc.npcId);
          npc.phase = "idle";
          npc.revision = state.revision;
        }
      }
  };
  const snapshot = (channelId: string, state: Channel) => {
    prune(state);
    return {
      channelId,
      protocolVersion: 1,
      revision: state.revision,
      ambientLeaderId: leader(channelId),
      npcs: [...state.npcs.values()].map((npc) => ({ ...npc })),
      seats: [...state.reservations.values()].map(
        ({ seatId, actorId, ownerSocketId, x, y, spatial }) => ({
          seatId,
          actorId,
          ownerSocketId,
          x,
          y,
          ...(spatial ? { spatial: true } : {}),
        }),
      ),
    };
  };
  const broadcast = (channelId: string, state: Channel) => {
    if (!isCurrent(state)) return;
    state.ambientLeaderId = leader(channelId);
    return io.to(channelId).emit("npc:motion-state", snapshot(channelId, state));
  };
  // 채널:NPC → 마지막으로 권위 상태가 바뀐 시각. 위치 통지·호출·이동 시작이 모두 `changed` 를
  // 거치므로 여기서 찍으면 "진척이 있었다" 의 기준이 한 곳에 모인다.
  const motionAt = new Map<string, number>();
  const changed = (state: Channel, npc?: NpcMotion) => {
    state.revision = nextRevision(state.channelId);
    if (npc) {
      npc.revision = state.revision;
      motionAt.set(`${state.channelId}:${npc.npcId}`, now());
    }
  };
  const releaseActor = (state: Channel, actorId: string) => {
    for (const [id, seat] of state.reservations)
      if (seat.actorId === actorId) {
        state.reservations.delete(id);
        changed(state);
      }
  };
  /**
   * 구동할 브라우저가 없는 회의 이동을 **결과만 정산한다.**
   *
   * 회의 이동(`spatial.move`)은 서버가 목표만 박고 걸음은 소유 브라우저가 진행시킨다 —
   * 이 파일 머리말대로 서버는 경로를 돌리지 않는다. 그래서 구동자가 사라지면 걸음이 멈추고,
   * 재개 루프는 phase `returning` 만 보기 때문에 회의 이동(`called`)은 영구히 굳었다.
   * 혼자 쓰는 사용자가 나가면 항상 이 상태가 됐고, 회의석이 점유된 채 남아 다음 회의도
   * 열 수 없었다.
   *
   * 보는 사람이 없는 걸음을 재생할 이유는 없다. 목표 좌표로 옮기고 예약을 도착으로 확정해
   * 회의 세션까지 진행시킨다(`onSpatialArrival`). 사용자가 돌아오면 NPC 는 이미 자기 자리에 있다.
   */
  const settleSpatial = (
    state: Channel,
    npc: NpcMotion,
    channelId: string,
    at: { x: number; y: number },
  ) => {
    const target = npc.spatialTarget;
    npc.x = at.x;
    npc.y = at.y;
    npc.spatialTarget = null;
    npc.continuation = null;
    npc.moving = false;
    npc.ownerSocketId = null;
    npc.phase = "idle";
    state.excursions.delete(npc.npcId);
    for (const reservation of state.reservations.values())
      if (reservation.actorId === npc.npcId) {
        reservation.x = at.x;
        reservation.y = at.y;
        reservation.arrived = true;
        reservation.spatial = false;
        reservation.expires = now() + 60_000;
      }
    changed(state, npc);
    if (target) dependencies.onSpatialArrival?.(channelId, npc.npcId, target.generation);
  };
  /**
   * 구동자가 사라진 회의 이동을 어떻게 끝낼지 정한다.
   *
   * - **자리로 돌아가는 중**이면 목표(원래 좌석이나 대체 설 자리)로 정산한다.
   * - **회의로 들어가던 중**이면 회의는 사용자 없이 진행할 수 없으니 세션은 막되
   *   (`driver_disconnected`), NPC 를 걸음 도중에 굳혀 두지 않고 **제자리로** 정산하고
   *   회의석 예약을 놓아준다. 그러지 않으면 다음 회의도 열리지 않는다.
   */
  const settleDriverlessSpatial = (state: Channel, npc: NpcMotion, channelId: string) => {
    const target = npc.spatialTarget;
    if (!target) return;
    if (target.returning) {
      settleSpatial(state, npc, channelId, target);
      return;
    }
    const generation = target.generation;
    releaseActor(state, npc.npcId);
    settleSpatial(state, npc, channelId, { x: npc.homeX, y: npc.homeY });
    dependencies.onSpatialBlocked?.(channelId, npc.npcId, "driver_disconnected", generation);
  };
  const validPoint = (state: Channel, x: unknown, y: unknown): boolean =>
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    (!state.data.bounds || (x < state.data.bounds.width && y < state.data.bounds.height));
  const updateReservation = (
    state: Channel,
    actorId: string,
    position: { x: number; y: number },
  ) => {
    for (const [id, seat] of state.reservations)
      if (seat.actorId === actorId) {
        const separation = distance(seat, position);
        if (seat.arrived && separation > 20) {
          state.reservations.delete(id);
          changed(state);
        } else {
          if (separation <= 8) seat.arrived = true;
          seat.expires = now() + 60_000;
        }
      }
  };
  async function authorized(socket: Socket, channelId: unknown) {
    if (!member(socket, channelId)) return null;
    const pending = load(channelId);
    const state = await pending;
    // A map reset can finish while this load is pending. The old promise must
    // never regain authority, even if the same socket has already rejoined.
    return channels.get(channelId) === pending && member(socket, channelId) && socket.connected
      ? state
      : null;
  }
  function register(socket: Socket) {
    const handle = (
      name: string,
      action: (
        payload: Record<string, unknown>,
        state: Channel,
        channelId: string,
      ) => { error?: string; seatId?: string } | void,
    ) => {
      socket.on(name, async (raw: unknown, ack?: Ack) => {
        const reply = (result: Parameters<Ack>[0]) => {
          if (typeof ack === "function") ack(result);
        };
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          reply({ ok: false, error: "invalid_payload" });
          return;
        }
        const payload = raw as Record<string, unknown>;
        try {
          const state = await authorized(socket, payload.channelId);
          if (
            !state ||
            !isCurrent(state) ||
            !member(socket, payload.channelId) ||
            !socket.connected
          ) {
            reply({ ok: false, error: "forbidden" });
            return;
          }
          const channelId = payload.channelId as string;
          prune(state);
          const result = action(payload, state, channelId);
          if (result?.error) {
            socket.emit("npc:motion-state", snapshot(channelId, state));
            reply({ ok: false, error: result.error });
          } else
            reply({
              ok: true,
              revision: state.revision,
              ...(result?.seatId ? { seatId: result.seatId } : {}),
            });
        } catch {
          reply({ ok: false, error: "unavailable" });
        }
      });
    };
    handle("npc:call", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc) return { error: "unknown_npc" };
      if (npc.spatialTarget) return { error: "meeting_reserved" };
      // 남의 소유권을 넘겨받을 수 있는 상태는 둘이다.
      //
      // - `ambient`: 소유권이 "대화 중" 이 아니라 산책 걸음을 돌리는 드라이버다(기존 규칙).
      // - `returning`: 자리로 돌아가는 중 — 아무도 대화하고 있지 않다. 특히 재접속 유예가
      //   끝나면 `prune` 이 소유권을 남은 leader 에게 넘기고 phase 를 `returning` 으로 두는데,
      //   그 leader 를 소유자로 대접하면 **아무도 부르지 않은 직원을 아무도 부를 수 없다.**
      //
      // 다만 귀가 가로채기는 **사람이 누른 호출** 에만 허용한다. 방 런타임이 대화 차례마다
      // 자동으로 쏘는 호출(`reason: "map-chat"`)까지 허용하면 남이 자리로 보낸 NPC 를 대화가
      // 계속 끌어당긴다 — 그 규칙은 "legacy room intent … preserves competing ownership"
      // 테스트가 지키고 있다.
      //
      // **이 구분은 보안 경계가 아니다.** `reason` 은 클라이언트가 주는 값이라 빼고 보내면
      // 사람이 누른 호출로 취급된다. 지금은 같은 채널 멤버가 어차피 호출 버튼으로 할 수 있는
      // 일이라 얻을 것이 없지만, 호출에 권한 차등이 생기면 이 한 줄로는 막지 못한다 —
      // 그때는 서버가 아는 사실(방 런타임이 시작한 호출인지)로 갈라야 한다.
      const roomTurn = payload.reason === "map-chat";
      if (
        npc.ownerSocketId &&
        npc.ownerSocketId !== socket.id &&
        npc.phase !== "ambient" &&
        !(npc.phase === "returning" && !roomTurn)
      )
        return { error: "already_claimed" };
      // 내가 이미 주인이어도 **재호출**로 다룬다. 예전에는 여기서 broadcast 만 하고 조용히
      // 돌아섰고, `npc:come-to-player` 가 나가지 않아 아무도 움직이지 않았다 — 오류도 없다.
      // 같은 신분으로 다시 접속하면 소유권이 새 소켓으로 넘어오므로(`rebindOwner`), 탭을
      // 새로 열고 호출하는 흔한 흐름이 정확히 이 분기였다. 아래 한 경로로 합친다.
      releaseActor(state, npc.npcId);
      state.excursions.delete(npc.npcId);
      Object.assign(npc, {
        ownerSocketId: socket.id,
        phase: "called",
        moving: true,
        continuation: null,
      });
      changed(state, npc);
      broadcast(channelId, state);
      io.to(channelId).emit("npc:come-to-player", {
        npcId: npc.npcId,
        targetPlayerId: socket.id,
        ...(payload.reason === "map-chat"
          ? {
              reason: "map-chat",
              ...(typeof payload.roomId === "string" ? { roomId: payload.roomId } : {}),
            }
          : {}),
      });
    });
    handle("npc:return-home", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc) return { error: "unknown_npc" };
      if (npc.spatialTarget) return { error: "meeting_reserved" };
      if (
        npc.ownerSocketId !== socket.id &&
        !(npc.phase === "ambient" && leader(channelId) === socket.id)
      )
        return { error: "not_owner" };
      releaseActor(state, npc.npcId);
      npc.ownerSocketId = socket.id;
      npc.phase = "returning";
      npc.continuation = null;
      npc.moving = true;
      changed(state, npc);
      broadcast(channelId, state);
      io.to(channelId).emit("npc:returning", { npcId: npc.npcId });
    });
    handle("npc:position-update", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc) return { error: "unknown_npc" };
      if (!validPoint(state, payload.x, payload.y) || !directions.has(String(payload.direction)))
        return { error: "invalid_motion" };
      const continuation = parseMotionContinuation(payload.continuation, state.data.bounds);
      if (!continuation.ok) return { error: "invalid_continuation" };
      if (npc.phase === "idle" || npc.phase === "ambient") {
        if (leader(channelId) !== socket.id) return { error: "not_owner" };
        if (npc.phase === "idle" && (payload.x !== npc.homeX || payload.y !== npc.homeY)) {
          if (state.excursions.size >= 2) return { error: "ambient_limit" };
          state.excursions.add(npc.npcId);
          npc.phase = "ambient";
        }
        npc.ownerSocketId = null;
      } else if (npc.ownerSocketId !== socket.id) return { error: "not_owner" };
      if (npc.spatialTarget) {
        const destination = { x: payload.x as number, y: payload.y as number };
        if (
          !consumeMotion(`${channelId}:${npc.npcId}`, distance(npc, destination), NPC_SPEED_CAP) ||
          (state.data.isWalkable &&
            !clearSegment(
              { x: npc.x / 32 - 0.5, y: npc.y / 32 - 0.5 },
              { x: destination.x / 32 - 0.5, y: destination.y / 32 - 0.5 },
              state.data.isWalkable,
            ))
        )
          return { error: "invalid_motion" };
        spatialLastMotion.set(`${channelId}:${npc.npcId}`, now());
      }
      if (continuation.value !== undefined) npc.continuation = continuation.value;
      npc.x = payload.x as number;
      npc.y = payload.y as number;
      npc.direction = payload.direction as string;
      npc.moving = npc.phase !== "idle";
      updateReservation(state, npc.npcId, npc);
      changed(state, npc);
      broadcast(channelId, state);
      socket.to(channelId).emit("npc:position-sync", {
        npcId: npc.npcId,
        x: npc.x,
        y: npc.y,
        direction: npc.direction,
      });
    });
    handle("npc:continuation-update", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc) return { error: "unknown_npc" };
      if (
        npc.ownerSocketId !== socket.id &&
        !(
          npc.ownerSocketId === null &&
          (npc.phase === "idle" || npc.phase === "ambient") &&
          leader(channelId) === socket.id
        )
      )
        return { error: "not_owner" };
      const continuation = parseMotionContinuation(payload.continuation, state.data.bounds);
      if (!continuation.ok) return { error: "invalid_continuation" };
      if (continuation.value !== undefined) {
        npc.continuation = continuation.value;
        changed(state, npc);
        broadcast(channelId, state);
      }
    });
    handle("npc:arrived", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc) return { error: "unknown_npc" };
      if (npc.spatialTarget) {
        const target = npc.spatialTarget;
        if (npc.ownerSocketId !== socket.id) return { error: "not_owner" };
        if (payload.generation !== target.generation) return { error: "stale_generation" };
        if (distance(npc, target) > 2) return { error: "not_at_target" };
        const reservation = [...state.reservations.values()].find(
          (r) => r.actorId === npc.npcId && r.x === target.x && r.y === target.y,
        );
        if (!reservation || !reservation.arrived) return { error: "reservation_lost" };
        npc.moving = false;
        npc.phase = "waiting";
        if (target.returning) {
          npc.spatialTarget = null;
          npc.phase = distance(npc, { x: npc.homeX, y: npc.homeY }) <= 2 ? "idle" : "ambient";
          npc.ownerSocketId = null;
          if (npc.phase === "idle") state.excursions.delete(npc.npcId);
          else state.excursions.add(npc.npcId);
          if (!target.seatId || npc.phase === "idle") releaseActor(state, npc.npcId);
          else {
            // 검증된 복귀 도착 후에는 일반 좌석 예약으로 넘긴다.
            reservation.spatial = false;
            reservation.expires = now() + 60_000;
          }
        }
        changed(state, npc);
        broadcast(channelId, state);
        dependencies.onSpatialArrival?.(channelId, npc.npcId, target.generation);
        return;
      }
      if (npc.phase === "idle" && leader(channelId) === socket.id) {
        broadcast(channelId, state);
        socket.to(channelId).emit("npc:stop-moving", { npcId: npc.npcId });
        return;
      }
      if (
        npc.ownerSocketId !== socket.id &&
        !(npc.phase === "ambient" && leader(channelId) === socket.id)
      )
        return { error: "not_owner" };
      if (npc.phase === "returning" && distance(npc, { x: npc.homeX, y: npc.homeY }) > 2)
        return { error: "not_at_home" };
      npc.moving = false;
      if (npc.phase === "called") npc.phase = "waiting";
      else if (
        npc.phase === "returning" ||
        (npc.phase === "ambient" && distance(npc, { x: npc.homeX, y: npc.homeY }) <= 2)
      ) {
        npc.phase = "idle";
        npc.ownerSocketId = null;
        state.excursions.delete(npc.npcId);
        releaseActor(state, npc.npcId);
      }
      changed(state, npc);
      broadcast(channelId, state);
      socket.to(channelId).emit("npc:stop-moving", { npcId: npc.npcId });
    });
    handle("seat:claim", (payload, state, channelId) => {
      const seat = state.data.seats.find((seat) => seat.id === payload.seatId);
      if (!seat) return { error: "unknown_seat" };
      const actorId = typeof payload.actorId === "string" ? payload.actorId : socket.id;
      const npc = state.npcs.get(actorId);
      if (npc?.spatialTarget) return { error: "meeting_reserved" };
      if (
        actorId !== socket.id &&
        (!npc ||
          (npc.ownerSocketId !== socket.id &&
            !(
              npc.ownerSocketId === null &&
              (npc.phase === "idle" || npc.phase === "ambient") &&
              leader(channelId) === socket.id
            )))
      )
        return { error: "not_owner" };
      const spatialReservation = [...state.reservations.values()].find(
        (reservation) => reservation.actorId === actorId && reservation.spatial,
      );
      if (spatialReservation)
        return spatialReservation.seatId === seat.id &&
          spatialReservation.ownerSocketId === socket.id
          ? { seatId: seat.id }
          : { error: "meeting_reserved" };
      const existing = state.reservations.get(seat.id);
      if (existing && (existing.actorId !== actorId || existing.ownerSocketId !== socket.id))
        return { error: "seat_occupied" };
      const occupied =
        [...state.npcs.values()].some(
          (other) => other.npcId !== actorId && distance(other, seat) < 16,
        ) ||
        [...state.players].some(
          ([id, position]) => id !== actorId && distance(position, seat) < 16,
        );
      if (occupied) return { error: "seat_occupied" };
      if (npc && npc.phase === "idle") {
        if (state.excursions.size >= 2) return { error: "ambient_limit" };
        state.excursions.add(npc.npcId);
        npc.phase = "ambient";
        changed(state, npc);
      }
      releaseActor(state, actorId);
      const position = npc ?? state.players.get(socket.id);
      state.reservations.set(seat.id, {
        seatId: seat.id,
        actorId,
        ownerSocketId: socket.id,
        x: seat.x,
        y: seat.y,
        arrived: !!position && distance(position, seat) <= 8,
        expires: now() + 60_000,
      });
      changed(state);
      broadcast(channelId, state);
      return { seatId: seat.id };
    });
    handle("seat:release", (payload, state, channelId) => {
      const actorId = typeof payload.actorId === "string" ? payload.actorId : socket.id;
      const npc = state.npcs.get(actorId);
      if (npc?.spatialTarget) return { error: "meeting_reserved" };
      if (
        actorId !== socket.id &&
        npc?.ownerSocketId !== socket.id &&
        !(npc?.phase === "ambient" && leader(channelId) === socket.id)
      )
        return { error: "not_owner" };
      if ([...state.reservations.values()].some((r) => r.actorId === actorId && r.spatial))
        return { error: "meeting_reserved" };
      releaseActor(state, actorId);
      if (
        npc?.phase === "ambient" &&
        !npc.moving &&
        distance(npc, { x: npc.homeX, y: npc.homeY }) <= 2
      ) {
        npc.phase = "idle";
        state.excursions.delete(npc.npcId);
        changed(state, npc);
      }
      broadcast(channelId, state);
    });
    handle("npc:spatial-failed", (payload, state, channelId) => {
      const npc = state.npcs.get(String(payload.npcId));
      if (!npc?.spatialTarget || npc.ownerSocketId !== socket.id) return { error: "not_owner" };
      if (payload.generation !== npc.spatialTarget.generation) return { error: "stale_generation" };
      npc.moving = false;
      dependencies.onSpatialBlocked?.(
        channelId,
        npc.npcId,
        "path_unavailable",
        npc.spatialTarget.generation,
      );
      changed(state, npc);
      broadcast(channelId, state);
    });
    socket.on("disconnecting", () => {
      for (const channelId of socket.rooms)
        if (channelId !== socket.id) void left(socket, channelId);
    });
  }
  const rebindOwner = (state: Channel, oldId: string, newId: string) => {
    const departure = state.disconnected.get(oldId);
    if (departure) clearTimeout(departure.timer);
    state.disconnected.delete(oldId);
    state.identities.delete(oldId);
    for (const npc of state.npcs.values()) {
      if (npc.ownerSocketId === oldId) {
        npc.ownerSocketId = newId;
        changed(state, npc);
      }
    }
    for (const reservation of state.reservations.values()) {
      if (
        reservation.ownerSocketId !== oldId ||
        state.npcs.get(reservation.actorId)?.phase === "ambient"
      )
        continue;
      reservation.ownerSocketId = newId;
      if (reservation.actorId === oldId) reservation.actorId = newId;
      reservation.expires = now() + 60_000;
      changed(state);
    }
  };
  async function joined(socket: Socket, channelId: string) {
    const state = await authorized(socket, channelId);
    if (state && isCurrent(state) && member(socket, channelId) && socket.connected) {
      const dormant = inactive.get(channelId);
      if (dormant) {
        const paused = Math.max(0, now() - dormant.startedAt);
        for (const seat of state.reservations.values()) if (!seat.arrived) seat.expires += paused;
      }
      cancelInactive(channelId);
      prune(state);
      const key = identity(socket.id, channelId);
      if (key) {
        for (const [oldId, departure] of state.disconnected) {
          if (departure.identity !== key) continue;
          rebindOwner(state, oldId, socket.id);
        }
        state.identities.set(socket.id, key);
      }
      const player = dependencies.getPlayer(socket.id);
      if (player && validPoint(state, player.x, player.y))
        state.players.set(socket.id, { x: player.x!, y: player.y! });
      if (player && validPoint(state, player.x, player.y)) {
        validatedPlayers.set(`${channelId}:${socket.id}`, { x: player.x!, y: player.y! });
        spatialLastMotion.set(`${channelId}:${socket.id}`, now());
      }
      const currentLeader = leader(channelId);
      for (const npc of state.npcs.values()) {
        // 회의 이동이 남아 있는 NPC 도 재개 대상이다. 예전에는 phase `returning` 만 봐서,
        // phase 가 `called` 인 회의 복귀는 재입장해도 영구히 재개되지 않았다.
        if (npc.spatialTarget && !npc.ownerSocketId && currentLeader) {
          npc.ownerSocketId = currentLeader;
          npc.moving = true;
          changed(state, npc);
          continue;
        }
        if (npc.phase === "returning" && !npc.ownerSocketId && currentLeader) {
          npc.ownerSocketId = currentLeader;
          npc.moving = true;
          changed(state, npc);
        }
      }
      for (const seat of state.reservations.values())
        if (state.npcs.get(seat.actorId)?.phase === "ambient" && currentLeader)
          seat.ownerSocketId = currentLeader;
      broadcast(channelId, state);
    }
  }
  async function moved(socket: Socket, x: number, y: number) {
    const channelId = dependencies.getPlayer(socket.id)?.mapId;
    const state = await authorized(socket, channelId);
    if (
      !state ||
      !isCurrent(state) ||
      !member(socket, channelId) ||
      !socket.connected ||
      !validPoint(state, x, y)
    )
      return;
    const reservation = [...state.reservations.values()].find(
      (r) => r.actorId === socket.id && r.spatial,
    );
    {
      const key = `${channelId}:${socket.id}`;
      const previous = validatedPlayers.get(key);
      if (
        previous &&
        (!consumeMotion(key, distance(previous, { x, y }), 220) ||
          (state.data.isWalkable &&
            !clearSegment(
              { x: previous.x / 32 - 0.5, y: previous.y / 32 - 0.5 },
              { x: x / 32 - 0.5, y: y / 32 - 0.5 },
              state.data.isWalkable,
            )))
      ) {
        if (reservation) return;
      } else validatedPlayers.set(key, { x, y });
      spatialLastMotion.set(key, now());
    }
    const revision = state.revision;
    state.players.set(socket.id, { x, y });
    prune(state);
    if (reservation?.arrived && distance(reservation, { x, y }) > 20) {
      const userId = dependencies.getPlayer(socket.id)?.userId;
      if (userId) dependencies.onSpatialPlayerBlocked?.(channelId!, userId);
    }
    updateReservation(state, socket.id, { x, y });
    if (reservation && atReservationPoint(reservation, { x, y })) {
      const userId = dependencies.getPlayer(socket.id)?.userId;
      if (userId) dependencies.onSpatialPlayerArrival?.(channelId!, userId, socket.id);
    }
    if (state.revision !== revision) broadcast(channelId!, state);
  }
  async function left(socket: Socket, channelId: string) {
    const pending = channels.get(channelId);
    if (!pending) return;
    // Mark dormancy before awaiting an in-flight map refresh; its completion
    // must retain the shared state rather than evicting it as an unused preload.
    if (!members(channelId, socket.id).length) retainInactive(channelId);
    let state: Channel;
    try {
      state = await pending;
    } catch {
      return;
    }
    if (!isCurrent(state)) return;
    state.players.delete(socket.id);
    validatedPlayers.delete(`${channelId}:${socket.id}`);
    spatialLastMotion.delete(`${channelId}:${socket.id}`);
    spatialMotionCredit.delete(`${channelId}:${socket.id}`);
    const next = leader(channelId, socket.id);
    const key = state.identities.get(socket.id);
    const replacement =
      key && members(channelId, socket.id).find((id) => state.identities.get(id) === key);
    if (replacement) rebindOwner(state, socket.id, replacement);
    if (key && !replacement && !state.disconnected.has(socket.id)) {
      const timer = setTimeout(() => {
        void channels
          .get(channelId)
          ?.then((current) => {
            if (!isCurrent(current)) return;
            const revision = current.revision;
            prune(current);
            if (current.revision !== revision && members(channelId).length)
              broadcast(channelId, current);
          })
          .catch(() => {});
      }, NPC_RECONNECT_GRACE_MS);
      timer.unref();
      state.disconnected.set(socket.id, {
        identity: key,
        expires: now() + NPC_RECONNECT_GRACE_MS,
        timer,
      });
    }
    for (const [id, reservation] of state.reservations) {
      if (reservation.ownerSocketId !== socket.id) continue;
      if (state.npcs.get(reservation.actorId)?.phase === "ambient") {
        // The actor owns its reservation; its elected browser driver is replaceable.
        if (next) reservation.ownerSocketId = next;
      } else if (!key) {
        state.reservations.delete(id);
      }
      changed(state);
    }
    for (const npc of state.npcs.values()) {
      if (npc.ownerSocketId === socket.id && npc.spatialTarget && !replacement) {
        if (next) {
          // 다른 브라우저가 남아 있다 — 걸음을 넘기고 계속 간다. 세션을 죽일 이유가 없다.
          npc.ownerSocketId = next;
          npc.moving = true;
          changed(state, npc);
          continue;
        }
        settleDriverlessSpatial(state, npc, channelId);
        continue;
      }
      if (npc.ownerSocketId === socket.id && !key) {
        npc.ownerSocketId = next;
        npc.phase = "returning";
        npc.moving = !!next;
        changed(state, npc);
      }
    }
    state.ambientLeaderId = next;
    if (!members(channelId, socket.id).length) {
      retainInactive(channelId);
      return;
    }
    broadcast(channelId, state);
  }
  async function invalidate(channelId: string) {
    const pending = channels.get(channelId);
    if (!pending) return;
    let old: Channel;
    try {
      old = await pending;
    } catch {
      return;
    }
    if (
      channels.get(channelId) !== pending ||
      (!members(channelId).length && !inactive.has(channelId))
    ) {
      if (channels.get(channelId) === pending) channels.delete(channelId);
      return;
    }
    const replacement: Promise<Channel> = dependencies.loadChannel(channelId).then((data) => {
      if (channels.get(channelId) !== replacement) throw Error("Stale channel invalidation");
      const state = create(data, channelId, replacement);
      state.identities = old.identities;
      state.disconnected = old.disconnected;
      state.players = old.players;
      state.excursions = new Set([...old.excursions].filter((id) => state.npcs.has(id)));
      const reallocated = new Set<string>();
      for (const [id, npc] of state.npcs) {
        const previous = old.npcs.get(id);
        if (
          data.sanitizedHomes &&
          previous &&
          (previous.homeX !== npc.homeX || previous.homeY !== npc.homeY)
        ) {
          // Roster allocation can move an invalid persisted home. The old seat,
          // live position and continuation may now belong to another actor.
          reallocated.add(id);
          state.excursions.delete(id);
          npc.revision = state.revision;
        } else if (previous)
          state.npcs.set(id, { ...previous, homeX: npc.homeX, homeY: npc.homeY });
        const target = previous?.spatialTarget;
        if (
          target &&
          (reallocated.has(id) ||
            (target.seatId && !data.seats.some((s) => s.id === target.seatId)) ||
            (data.canStandAt && !data.canStandAt(target)))
        ) {
          state.npcs.get(id)!.moving = false;
          dependencies.onSpatialBlocked?.(
            channelId,
            id,
            "destination_invalidated",
            target.generation,
          );
        }
      }
      for (const [id, reservation] of old.reservations)
        if (
          !reallocated.has(reservation.actorId) &&
          (data.seats.some((seat) => seat.id === id) ||
            (reservation.spatial && data.canStandAt?.(reservation))) &&
          (state.npcs.has(reservation.actorId) ||
            state.disconnected.has(reservation.actorId) ||
            members(channelId).includes(reservation.actorId))
        )
          state.reservations.set(id, reservation);
      for (const [id, previous] of old.npcs) {
        if (previous.spatialTarget && !state.npcs.has(id))
          dependencies.onSpatialBlocked?.(
            channelId,
            id,
            "actor_unavailable",
            previous.spatialTarget.generation,
          );
      }
      return state;
    });
    channels.set(channelId, replacement);
    try {
      const state = await replacement;
      if (!isCurrent(state)) return;
      if (!members(channelId).length) {
        if (!inactive.has(channelId) && channels.get(channelId) === replacement)
          channels.delete(channelId);
        return;
      }
      broadcast(channelId, state);
    } catch {
      if (channels.get(channelId) === replacement) channels.delete(channelId);
    }
  }
  /** Map replacement is a hard runtime boundary: no old reservations or paths survive. */
  async function reset(channelId: string) {
    evict(channelId);
    // Fresh joins load/sanitize homes from the new map. No old owner can retain
    // a reservation; a channel deleted during CAS does not poison reset.
  }
  async function occupancy(channelId: string, excludePlayerId?: string) {
    const pending = load(channelId);
    const state = await pending;
    if (!isCurrent(state)) throw Error("Stale channel occupancy");
    const positions = [...state.npcs.values()]
      .map(({ x, y }) => ({ x, y }))
      .concat(
        [...state.players.entries()]
          .filter(([id]) => id !== excludePlayerId)
          .map(([, { x, y }]) => ({ x, y })),
      );
    // Prejoin reads have no room membership to trigger disconnect cleanup.
    if (
      !members(channelId).length &&
      !inactive.has(channelId) &&
      channels.get(channelId) === pending
    )
      channels.delete(channelId);
    return positions;
  }

  const spatial = {
    async isInside(channelId: string, socketId: string) {
      const state = await load(channelId),
        position = validatedPlayers.get(`${channelId}:${socketId}`);
      return (
        isCurrent(state) &&
        !!position &&
        !!state.data.meetingSpace &&
        dependencies.getPlayer(socketId)?.mapId === channelId &&
        insideMeetingSpace(state.data.meetingSpace.bounds, position.x / 32, position.y / 32)
      );
    },
    async layout(channelId: string) {
      const state = await load(channelId);
      if (!isCurrent(state)) throw new Error("stale_channel_layout");
      if (!state.data.meetingSpace) throw new Error("meeting_space_unavailable");
      return {
        spaceId: state.data.meetingSpace.id,
        targets: [
          ...state.data.meetingSpace.seatIds.flatMap((id) => {
            const seat = state.data.seats.find((s) => s.id === id);
            return seat ? [{ x: seat.x, y: seat.y, seatId: id }] : [];
          }),
          ...state.data.meetingSpace.standingPositions.map((p) => ({
            x: p.x,
            y: p.y,
            seatId: null,
          })),
        ],
      };
    },
    /**
     * 회의 집결이 직원을 데려가기 전에 돌아올 자리를 잡는다. 누군가의 호출에 묶인 직원은 주지 않는다 —
     * 다만 **회의를 여는 사람 본인 소켓**(`takeFromSocketId`)이 소유한 호출이면 풀고 데려간다.
     * 여는 사람이 자기가 부른 직원(자동 보고 호출 포함)을 회의에 데려가는 것은 그 사람의 의도와
     * 같은 방향이다. 남이 데리고 있는 직원은 절대 빼앗지 않는다.
     *
     * 푼 경우 원위치는 **자기 자리(home)** 다. 호출로 끌려온 지금 자리를 원위치로 잡으면 회의가 끝나고
     * 주재자 옆으로 돌아간다. 호출은 좌석 예약을 이미 놓았으므로(`npc:call` 의 `releaseActor`) 예약에서
     * 원래 자리를 찾을 수 없고, 호출이 끝나면 어차피 home 으로 돌아가는 것이 기존 규칙이다.
     */
    async capture(channelId: string, actorId: string, takeFromSocketId?: string) {
      const state = await load(channelId),
        npc = state.npcs.get(actorId);
      if (!isCurrent(state)) return null;
      if (!npc) return null;
      if (npc.ownerSocketId && !npc.spatialTarget && npc.phase !== "ambient") {
        if (!takeFromSocketId || npc.ownerSocketId !== takeFromSocketId) return null;
        // 내 호출을 푼다. 소유자가 없어야 뒤따르는 회의 걸음(`move`)이 소유권 검사에 막히지 않는다.
        // 자리를 벗어나 있으면 `ambient` 로 둔다 — 회의 자리를 못 잡아도 산책 규칙이 집으로 데려간다.
        npc.ownerSocketId = null;
        npc.phase = distance(npc, { x: npc.homeX, y: npc.homeY }) <= 2 ? "idle" : "ambient";
        npc.moving = false;
        npc.continuation = null;
        changed(state, npc);
        broadcast(channelId, state);
        return {
          x: npc.homeX,
          y: npc.homeY,
          seatId:
            state.data.seats.find((s) => distance(s, { x: npc.homeX, y: npc.homeY }) <= 2)?.id ??
            null,
        };
      }
      const seat = [...state.reservations.values()].find((s) => s.actorId === actorId && s.arrived);
      return {
        x: npc.x,
        y: npc.y,
        seatId: seat?.seatId ?? state.data.seats.find((s) => distance(s, npc) <= 2)?.id ?? null,
      };
    },
    async reserve(channelId: string, actorId: string, target: MeetingSpatialTarget) {
      const state = await load(channelId);
      if (!isCurrent(state)) return false;
      prune(state);
      if (target.seatId && !state.data.seats.some((s) => s.id === target.seatId)) return false;
      if (
        !validPoint(state, target.x, target.y) ||
        (state.data.canStandAt && !state.data.canStandAt(target))
      )
        return false;
      if (
        [...state.reservations.values()].some(
          (s) => s.actorId !== actorId && distance(s, target) < 20,
        ) ||
        [...state.npcs.values()].some((n) => n.npcId !== actorId && distance(n, target) < 20) ||
        [...state.players].some(([id, p]) => id !== actorId && distance(p, target) < 20)
      )
        return false;
      const owner =
        state.npcs.get(actorId)?.ownerSocketId ??
        (state.players.has(actorId) ? actorId : leader(channelId));
      if (!owner) return false;
      releaseActor(state, actorId);
      const position = state.npcs.get(actorId) ?? state.players.get(actorId);
      const seatId = target.seatId ?? `standing:${target.x}:${target.y}`;
      state.reservations.set(seatId, {
        seatId,
        actorId,
        ownerSocketId: owner,
        x: target.x,
        y: target.y,
        arrived: !!position && distance(position, target) <= 8,
        expires: Infinity,
        spatial: true,
      });
      changed(state);
      broadcast(channelId, state);
      return true;
    },
    async move(
      channelId: string,
      actorId: string,
      generation: number,
      target: MeetingSpatialTarget,
      returning: boolean,
    ) {
      const state = await load(channelId),
        npc = state.npcs.get(actorId);
      const owner = leader(channelId);
      if (!isCurrent(state)) return false;
      if (!npc || (npc.ownerSocketId && !npc.spatialTarget && npc.phase !== "ambient"))
        return false;
      if (!owner) {
        // 구동할 브라우저가 하나도 없다(자동화·크론이 끝낸 회의, 또는 마지막 사용자가 떠난 뒤).
        // 예전에는 여기서 false 를 돌려줘 복귀가 `return_unavailable` 로 죽었고 NPC 는
        // 회의석에 남았다. 걸음을 볼 사람이 없으니 결과만 정산한다.
        npc.spatialTarget = { ...target, generation, returning };
        settleSpatial(state, npc, channelId, target);
        broadcast(channelId, state);
        return true;
      }
      npc.ownerSocketId = owner;
      npc.phase = "called";
      npc.moving = true;
      npc.continuation = null;
      npc.spatialTarget = { ...target, generation, returning };
      spatialLastMotion.set(`${channelId}:${actorId}`, now());
      spatialMotionCredit.set(`${channelId}:${actorId}`, 8);
      for (const r of state.reservations.values())
        if (r.actorId === actorId) r.ownerSocketId = owner;
      changed(state, npc);
      broadcast(channelId, state);
      return true;
    },
    async release(channelId: string, actorId: string) {
      const state = await load(channelId);
      if (!isCurrent(state)) return;
      releaseActor(state, actorId);
      changed(state);
      broadcast(channelId, state);
    },
    async atReservation(channelId: string, socketId: string) {
      const state = await load(channelId);
      if (!isCurrent(state)) return false;
      const position = state.players.get(socketId);
      const reservation = [...state.reservations.values()].find(
        (r) => r.actorId === socketId && r.spatial,
      );
      return !!position && !!reservation && atReservationPoint(reservation, position);
    },
    async returnTarget(channelId: string, actorId: string, origin: MeetingSpatialTarget) {
      const state = await load(channelId);
      if (!isCurrent(state)) return null;
      const npc = state.npcs.get(actorId);
      const reachable = (p: { x: number; y: number }) =>
        !state.data.isWalkable ||
        (!!npc &&
          !!findPath(
            Math.floor(npc.x / 32),
            Math.floor(npc.y / 32),
            Math.floor(p.x / 32),
            Math.floor(p.y / 32),
            state.data.isWalkable,
            (a, b) => clearSegment(a, b, state.data.isWalkable!),
          ));
      const available = (p: { x: number; y: number }) =>
        (!state.data.canStandAt || state.data.canStandAt(p)) &&
        [...state.npcs.values()].every((n) => n.npcId === actorId || distance(n, p) >= 20) &&
        [...state.players.values()].every((n) => distance(n, p) >= 20) &&
        [...state.reservations.values()].every(
          (n) => n.actorId === actorId || distance(n, p) >= 20,
        );
      if (
        available(origin) &&
        reachable(origin) &&
        (!origin.seatId || state.data.seats.some((s) => s.id === origin.seatId))
      )
        return origin;
      let best: MeetingSpatialTarget | null = null,
        bestDistance = Infinity;
      for (let y = 16; y < (state.data.bounds?.height ?? 0); y += 32)
        for (let x = 16; x < (state.data.bounds?.width ?? 0); x += 32) {
          const p = { x, y };
          const d = distance(p, origin);
          if (d < bestDistance && available(p) && reachable(p)) {
            best = { ...p, seatId: null };
            bestDistance = d;
          }
        }
      return best;
    },
  };
  /** 호출한 사람 곁의 설 자리. 네 방향 이웃 칸 중 설 수 있는 첫 칸, 없으면 그 사람 자리. */
  const besidePlayer = (state: Channel, player: { x: number; y: number }) => {
    const { width = Infinity, height = Infinity } = state.data.bounds ?? {};
    for (const [dx, dy] of [
      [32, 0],
      [-32, 0],
      [0, 32],
      [0, -32],
    ]) {
      const p = { x: player.x + dx, y: player.y + dy };
      if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
      if (state.data.canStandAt && !state.data.canStandAt(p)) continue;
      return p;
    }
    return { x: player.x, y: player.y };
  };
  /**
   * 걸음이 멈춘 소유 이동을 도착으로 확정한다. 탭이 돌아오면 화면은 스냅샷을 따라 순간이동한다.
   *
   * - 회의 이동: 들어가던 중이면 `npc:arrived` 와 같은 결과(좌석 도착·`waiting`)로, 돌아가던 중이면
   *   구동자 없는 복귀와 같은 정산으로 끝내고 회의 세션을 진행시킨다.
   * - 호출: 호출한 사람 곁에 세우고 `waiting` 으로 둔다. 소유권은 그대로라 보고·대화가 이어진다.
   */
  const settleStalled = (state: Channel, npc: NpcMotion, channelId: string) => {
    const target = npc.spatialTarget;
    if (target?.returning) {
      settleSpatial(state, npc, channelId, target);
      broadcast(channelId, state);
      return;
    }
    if (target) {
      npc.x = target.x;
      npc.y = target.y;
      npc.moving = false;
      npc.phase = "waiting";
      npc.continuation = null;
      for (const reservation of state.reservations.values())
        if (reservation.actorId === npc.npcId) {
          reservation.x = target.x;
          reservation.y = target.y;
          reservation.arrived = true;
        }
      changed(state, npc);
      broadcast(channelId, state);
      dependencies.onSpatialArrival?.(channelId, npc.npcId, target.generation);
      return;
    }
    const caller = npc.ownerSocketId ? dependencies.getPlayer(npc.ownerSocketId) : undefined;
    if (typeof caller?.x === "number" && typeof caller.y === "number") {
      const at = besidePlayer(state, { x: caller.x, y: caller.y });
      npc.x = at.x;
      npc.y = at.y;
    }
    npc.moving = false;
    npc.phase = "waiting";
    npc.continuation = null;
    changed(state, npc);
    broadcast(channelId, state);
    io.to(channelId).emit("npc:position-sync", {
      npcId: npc.npcId,
      x: npc.x,
      y: npc.y,
      direction: npc.direction,
    });
    io.to(channelId).emit("npc:stop-moving", { npcId: npc.npcId });
  };
  async function sweepStalled() {
    for (const pending of [...channels.values()]) {
      const state = await pending.catch(() => null);
      if (!state || !isCurrent(state)) continue;
      for (const npc of state.npcs.values()) {
        if (!npc.moving || !npc.ownerSocketId) continue;
        if (npc.phase !== "called" && !npc.spatialTarget) continue;
        const last = motionAt.get(`${state.channelId}:${npc.npcId}`) ?? now();
        if (now() - last < STALLED_MOTION_MS) continue;
        settleStalled(state, npc, state.channelId);
      }
    }
  }
  const sweepTimer = setInterval(() => {
    void sweepStalled().catch((error) => console.error("[npc-coordination] stall sweep", error));
  }, STALL_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  return { register, joined, moved, left, invalidate, reset, occupancy, spatial, sweepStalled };
}
