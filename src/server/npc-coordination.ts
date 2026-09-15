import type { Server, Socket } from "socket.io";
import { parseMotionContinuation, type MotionContinuation } from "./npc-motion-continuation";
import type { MeetingSpatialTarget, SpatialMotionTarget } from "../lib/meeting-discussion-state";
import { insideMeetingSpace, type MeetingSpace } from "../game/meeting-space";
import { clearSegment, findPath } from "../game/navigation";

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
const directions = new Set(["up", "down", "left", "right"]);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Process-local authority. DB homes and seat anchors are inputs; no pathfinding or AI calls. */
export function createNpcCoordination(io: Server, dependencies: CoordinationDependencies) {
  const channels = new Map<string, Promise<Channel>>();
  const now = dependencies.now ?? Date.now;
  const spatialLastMotion = new Map<string, number>();
  const spatialMotionCredit = new Map<string, number>();
  const validatedPlayers = new Map<string, { x: number; y: number }>();
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
  const create = (data: CoordinationChannel, channelId: string): Channel => ({
    channelId,
    identities: new Map(),
    disconnected: new Map(),
    data,
    revision: 0,
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
          revision: 0,
        },
      ]),
    ),
  });
  const load = (channelId: string) => {
    if ((inactive.get(channelId)?.expires ?? Infinity) <= now()) evict(channelId);
    let pending = channels.get(channelId);
    if (!pending) {
      pending = dependencies.loadChannel(channelId).then((data) => create(data, channelId));
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
          state.revision++;
        }
      }
      for (const npc of state.npcs.values()) {
        if (npc.ownerSocketId !== socketId) continue;
        if (npc.spatialTarget) {
          npc.ownerSocketId = leader(state.channelId);
          npc.moving = false;
          dependencies.onSpatialBlocked?.(
            state.channelId,
            npc.npcId,
            "driver_disconnected",
            npc.spatialTarget.generation,
          );
          changed(state, npc);
          continue;
        }
        npc.ownerSocketId = leader(state.channelId);
        npc.phase = "returning";
        npc.continuation = null;
        npc.moving = !!npc.ownerSocketId;
        npc.revision = ++state.revision;
      }
    }
    if (inactive.has(state.channelId)) return;
    for (const [id, reservation] of state.reservations)
      if (!reservation.spatial && !reservation.arrived && reservation.expires <= now()) {
        state.reservations.delete(id);
        state.revision++;
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
    state.ambientLeaderId = leader(channelId);
    return io.to(channelId).emit("npc:motion-state", snapshot(channelId, state));
  };
  const changed = (state: Channel, npc?: NpcMotion) => {
    state.revision++;
    if (npc) npc.revision = state.revision;
  };
  const releaseActor = (state: Channel, actorId: string) => {
    for (const [id, seat] of state.reservations)
      if (seat.actorId === actorId) {
        state.reservations.delete(id);
        changed(state);
      }
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
    const state = await load(channelId);
    // The await must not grant authority after leave/disconnect/channel switch.
    return member(socket, channelId) && socket.connected ? state : null;
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
          if (!state) {
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
      if (npc.ownerSocketId && npc.ownerSocketId !== socket.id && npc.phase !== "ambient")
        return { error: "already_claimed" };
      if (npc.ownerSocketId === socket.id) {
        broadcast(channelId, state);
        return;
      }
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
          !consumeMotion(`${channelId}:${npc.npcId}`, distance(npc, destination), 180) ||
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
    if (state) {
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
    if (!state || !validPoint(state, x, y)) return;
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
    if (reservation && distance(reservation, { x, y }) <= 2) {
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
        const generation = npc.spatialTarget.generation;
        npc.ownerSocketId = next;
        npc.moving = false;
        dependencies.onSpatialBlocked?.(channelId, npc.npcId, "driver_disconnected", generation);
        changed(state, npc);
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
    const old = await pending;
    if (
      channels.get(channelId) !== pending ||
      (!members(channelId).length && !inactive.has(channelId))
    ) {
      if (channels.get(channelId) === pending) channels.delete(channelId);
      return;
    }
    const replacement = dependencies.loadChannel(channelId).then((data) => {
      const state = create(data, channelId);
      state.identities = old.identities;
      state.disconnected = old.disconnected;
      state.revision = old.revision + 1;
      state.players = old.players;
      state.excursions = new Set([...old.excursions].filter((id) => state.npcs.has(id)));
      for (const [id, npc] of state.npcs) {
        const previous = old.npcs.get(id);
        if (previous) state.npcs.set(id, { ...previous, homeX: npc.homeX, homeY: npc.homeY });
        const target = previous?.spatialTarget;
        if (
          target &&
          ((target.seatId && !data.seats.some((s) => s.id === target.seatId)) ||
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
  async function occupancy(channelId: string, excludePlayerId?: string) {
    const pending = load(channelId);
    const state = await pending;
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
        !!position &&
        !!state.data.meetingSpace &&
        dependencies.getPlayer(socketId)?.mapId === channelId &&
        insideMeetingSpace(state.data.meetingSpace.bounds, position.x / 32, position.y / 32)
      );
    },
    async layout(channelId: string) {
      const state = await load(channelId);
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
    async capture(channelId: string, actorId: string) {
      const state = await load(channelId),
        npc = state.npcs.get(actorId);
      if (!npc || (npc.ownerSocketId && !npc.spatialTarget && npc.phase !== "ambient")) return null;
      const seat = [...state.reservations.values()].find((s) => s.actorId === actorId && s.arrived);
      return {
        x: npc.x,
        y: npc.y,
        seatId: seat?.seatId ?? state.data.seats.find((s) => distance(s, npc) <= 2)?.id ?? null,
      };
    },
    async reserve(channelId: string, actorId: string, target: MeetingSpatialTarget) {
      const state = await load(channelId);
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
      if (!npc || !owner || (npc.ownerSocketId && !npc.spatialTarget && npc.phase !== "ambient"))
        return false;
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
      releaseActor(state, actorId);
      changed(state);
      broadcast(channelId, state);
    },
    async returnTarget(channelId: string, actorId: string, origin: MeetingSpatialTarget) {
      const state = await load(channelId);
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
  return { register, joined, moved, left, invalidate, occupancy, spatial };
}
