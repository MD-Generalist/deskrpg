import { getRoomResponseSnapshot } from "./room-runtime";
// 방 단위 채팅의 소켓 계층. 예전 `chat:*`(채널 하나 = 대화 하나)를 대체한다.
//
// 소켓 룸 이름은 `room-<roomId>` 다. 채널 룸(`<channelId>`)과 겹치지 않게 접두어를 붙인다 —
// 겹치면 방 메시지가 맵에 있는 모든 사람에게 새어 나간다.
//
// **조용히 버리지 않는다.** 거절된 `room:send` 는 반드시 `room:error` 를 하나 쏜다.
// 예전 `handleChatSend` 는 쿨다운·빈 메시지를 `ignored` 로 삼켰고, 사용자에게는
// "입력창만 비워지고 아무 일도 안 일어남" 으로 보였다(docs/BACKLOG.md 2026-09-09).

import type { Server } from "socket.io";
import { resolveRoomAccessDecision, type RoomAccess } from "@/lib/chat-rooms-policy";
import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";
import type { UserContext } from "@/lib/user-context";
import type * as chatRooms from "@/lib/chat-rooms";
import type { PlayerState } from "./socket-handlers";
import type { getOrCreateRoomRuntime, invalidateRoomRuntime } from "./room-runtime";

export type RoomErrorCode =
  "forbidden" | "not_found" | "not_open" | "empty" | "cooldown" | "not_joined" | "invalid";

/** 사람 메시지 한 건의 최대 길이. 예전 `handleChatSend` 의 규칙을 그대로 옮겼다. */
const MAX_MESSAGE_LENGTH = 500;
/** `room:open` 이 되돌려 주는 지난 대화 줄 수. */
const HISTORY_LIMIT = 60;

type RoomSocket = {
  id: string;
  /** player:join 이 심은 값. `userContext` 는 부른 사람의 이름·소개(대본 앞머리에 들어간다). */
  data?: { userContext?: UserContext | null };
  on(event: string, handler: (payload: unknown) => unknown): void;
  emit(event: string, payload: unknown): void;
  join(room: string): void;
  leave(room: string): void;
};

type RoomIo = {
  to(room: string): { emit(event: string, payload: unknown): void };
};

/** 방 `roomId` 의 소켓 룸 이름. 채널 룸(`<channelId>`)과 겹치지 않게 접두어를 붙인다. */
export function roomSocketRoom(roomId: string): string {
  return `room-${roomId}`;
}

/**
 * 방에 메시지 한 건을 방송한다. 사람·NPC 발화와 자동화 알림(폴러의 `ingest`)이 같은
 * 경로를 타야 클라이언트가 한 리스너로 받는다 — `room:message` 는 이 한 벌뿐이다.
 */
export function broadcastRoomMessage(io: RoomIo, roomId: string, message: RoomMessage): void {
  io.to(roomSocketRoom(roomId)).emit("room:message", { roomId, message });
}

export type RegisterRoomHandlersArgs = {
  io: Server;
  socket: RoomSocket;
  deps: {
    user: { userId: string; nickname: string };
    players: Map<string, PlayerState>;
    lastChatTime: Map<string, number>;
    cooldownMs: number;
    getParticipationAccess: (
      channelId: string,
      userId: string,
    ) => Promise<{ access: { allowed: boolean } } | null>;
    rooms: typeof chatRooms;
    getRuntime: typeof getOrCreateRoomRuntime;
    invalidateRuntime: typeof invalidateRoomRuntime;
    now?: () => number;
  };
};

export type RoomHandlers = {
  list: (payload: unknown) => Promise<void>;
  open: (payload: unknown) => Promise<void>;
  close: (payload: unknown) => Promise<void>;
  send: (payload: unknown) => Promise<void>;
  create: (payload: unknown) => Promise<void>;
  invite: (payload: unknown) => Promise<void>;
  leave: (payload: unknown) => Promise<void>;
  rename: (payload: unknown) => Promise<void>;
  delete: (payload: unknown) => Promise<void>;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function memberKey(member: { kind: string; id: string }): string {
  return `${member.kind}:${member.id}`;
}

/**
 * 시스템 메시지는 서버가 한국어 문장을 박지 않고 구조를 넣는다 — 렌더는 클라이언트가
 * 자기 로케일로 한다. 서버가 문장을 만들면 방 하나의 기록이 그때 접속한 사람의 언어로
 * 굳어 버린다.
 */
function systemContent(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

export function registerRoomHandlers({ io, socket, deps }: RegisterRoomHandlersArgs): RoomHandlers {
  const {
    user,
    players,
    lastChatTime,
    cooldownMs,
    getParticipationAccess,
    rooms,
    getRuntime,
    invalidateRuntime,
    now = () => Date.now(),
  } = deps;
  const roomIo = io as unknown as RoomIo;

  /** 이 소켓이 지금 보고 있는 방들. `room:send` 는 여기 없는 방을 거절한다. */
  const openRooms = new Set<string>();
  /**
   * 이 소켓이 **듣고 있는** 사무실 방. `openRooms`(보낼 수 있는 방)와는 다른 개념이다.
   *
   * 자동화 알림(카드 검토·막힘·완료, 크론 실패)은 사무실 방으로 방송된다. 방송을 `room:open`
   * 한 소켓에만 보내면 DM·다른 그룹 방을 보고 있거나 패널을 접어 둔 사용자가 그 방으로
   * 돌아올 때까지 알림을 받지 못한다 — 알려야 할 바로 그 사용자다. 사무실 방은 채널당
   * 하나이고 채널에 들어올 수 있는 사람은 모두 볼 수 있으므로(하드 게이트 4), 채널 권한을
   * 확인한 `room:list` 에서 늘 듣게 한다.
   */
  let listeningOfficeId: string | null = null;

  const socketRoom = roomSocketRoom;

  function fail(roomId: string | null, code: RoomErrorCode) {
    socket.emit("room:error", { roomId, code });
  }

  async function channelAllowed(channelId: string): Promise<boolean> {
    const result = await getParticipationAccess(channelId, user.userId);
    return Boolean(result?.access.allowed);
  }

  async function resolveAccess(roomId: string): Promise<RoomAccess> {
    const room = await rooms.getRoom(roomId);
    if (!room) return { ok: false, code: "not_found" };
    return resolveRoomAccessDecision({
      room,
      channelAllowed: await channelAllowed(room.channelId),
      isMember: room.kind === "group" ? await rooms.isRoomMember(roomId, user.userId) : false,
    });
  }

  /**
   * 방 요약 한 건. `listRoomsForUser` 를 다시 태워 뽑는다 — 멤버 표시 이름과 마지막
   * 메시지를 조립하는 규칙이 한 곳에만 있어야 목록과 갱신 알림이 어긋나지 않는다.
   */
  async function summaryFor(
    channelId: string,
    roomId: string,
    forUserId = user.userId,
  ): Promise<RoomSummary | null> {
    const all = await rooms.listRoomsForUser(channelId, forUserId);
    return all.find((r) => r.id === roomId) ?? null;
  }

  /** 이 프로세스에 접속해 있는 그 사용자의 소켓들. 초대·생성 알림을 곧바로 밀어 넣는다. */
  function socketIdsForUsers(userIds: Set<string>): string[] {
    const ids: string[] = [];
    for (const [socketId, player] of players) {
      if (socketId !== socket.id && userIds.has(player.userId)) ids.push(socketId);
    }
    return ids;
  }

  async function appendSystemMessage(roomId: string, payload: Record<string, unknown>) {
    const message = await rooms.appendRoomMessage({
      roomId,
      senderKind: "system",
      senderId: null,
      senderName: "",
      content: systemContent(payload),
    });
    broadcastRoomMessage(roomIo, roomId, message);
  }

  const handlers: RoomHandlers = {
    async list(payload) {
      const { channelId } = (payload ?? {}) as { channelId?: unknown };
      const id = asString(channelId);
      if (!id) return fail(null, "invalid");
      if (!(await channelAllowed(id))) return fail(null, "forbidden");
      // 사무실 방은 채널의 기본값이라 목록을 물을 때 존재를 보장한다 — 채널을 만든
      // 시점에 만들지 않으므로(마이그레이션 이전 채널이 있다) 여기가 유일한 보장 지점이다.
      // 주인은 **채널 소유자**다. 부른 사람을 쓰면 먼저 들어온 손님이 사무실 방의
      // createdBy 가 된다.
      const ownerId = await rooms.getChannelOwnerId(id);
      if (!ownerId) return fail(null, "not_found");
      const office = await rooms.ensureOfficeRoom(id, ownerId);
      // 채널을 옮겨 다시 물으면 이전 채널의 사무실 방은 그만 듣는다(열어 둔 방이면 그대로 둔다).
      if (listeningOfficeId && listeningOfficeId !== office.id && !openRooms.has(listeningOfficeId))
        socket.leave(socketRoom(listeningOfficeId));
      listeningOfficeId = office.id;
      socket.join(socketRoom(office.id));
      socket.emit("room:list-response", {
        channelId: id,
        // 클라이언트는 자기 user id 를 알 길이 없다(뷰어 신원 엔드포인트가 없다).
        // 방을 만든 사람인지 가리려면 이 값이 필요하다.
        viewerUserId: user.userId,
        rooms: await rooms.listRoomsForUser(id, user.userId),
      });
      // 접속 전에 쌓인 알림도 배지에 잡히도록 최근 줄을 함께 내려 준다. 클라이언트의 보고 큐는
      // 받은 메시지에서만 파생하므로, 이게 없으면 방을 열기 전까지 큐가 비어 있다.
      // `history` 는 `messages[roomId]` 만 채운다 — 방이 열린 것처럼 되지는 않는다.
      socket.emit("room:history", {
        roomId: office.id,
        messages: await rooms.recentRoomMessages(office.id, HISTORY_LIMIT),
      });
    },

    async open(payload) {
      const { roomId } = (payload ?? {}) as { roomId?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");
      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);
      openRooms.add(id);
      socket.join(socketRoom(id));
      socket.emit("room:history", {
        roomId: id,
        messages: await rooms.recentRoomMessages(id, HISTORY_LIMIT),
      });
      socket.emit("room:response-snapshot", { roomId: id, responses: getRoomResponseSnapshot(id) });
    },

    async close(payload) {
      const { roomId } = (payload ?? {}) as { roomId?: unknown };
      const id = asString(roomId);
      if (!id) return;
      openRooms.delete(id);
      // 사무실 방은 닫아도 계속 듣는다 — 보내는 것만 막힌다(`openRooms` 에서 빠졌으므로 not_open).
      if (id !== listeningOfficeId) socket.leave(socketRoom(id));
    },

    async send(payload) {
      const { roomId, message } = (payload ?? {}) as { roomId?: unknown; message?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");

      // 재연결 뒤 새 socket.id — 클라이언트는 이 코드를 받고 player:join 을 다시 보낸다.
      const player = players.get(socket.id);
      if (!player) return fail(id, "not_joined");

      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);

      if (!openRooms.has(id)) return fail(id, "not_open");

      const content = String(message ?? "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);
      if (!content) return fail(id, "empty");

      const at = now();
      if (at - (lastChatTime.get(socket.id) || 0) < cooldownMs) return fail(id, "cooldown");
      lastChatTime.set(socket.id, at);

      const senderName = player.characterName || user.nickname;
      const saved = await rooms.appendRoomMessage({
        roomId: id,
        senderKind: "user",
        senderId: user.userId,
        senderName,
        content,
      });
      broadcastRoomMessage(roomIo, id, saved);

      // 런타임 조립(DB + 어댑터 해석)은 기다리지만 **NPC 의 턴은 기다리지 않는다.**
      // 턴은 수십 초가 걸리므로 여기서 await 하면 다음 메시지가 막힌다.
      try {
        const runtime = await getRuntime(io, access.room, user.userId);
        if (runtime) {
          void runtime
            .handleHumanMessage(
              senderName,
              content,
              socket.id,
              saved.id,
              socket.data?.userContext ?? null,
            )
            .catch((err) => console.error("[room] turn failed:", err));
        }
      } catch (err) {
        console.error("[room] runtime unavailable:", err);
      }
    },

    async create(payload) {
      const {
        channelId,
        name,
        npcIds: rawNpcIds,
        userIds: rawUserIds,
        requestId: rawRequestId,
      } = (payload ?? {}) as {
        channelId?: unknown;
        name?: unknown;
        npcIds?: unknown;
        userIds?: unknown;
        requestId?: unknown;
      };
      // 만든 사람의 화면만 새 방으로 들어간다. 클라이언트는 자기 user id 를 모르므로
      // 요청에 실어 보낸 표를 그대로 되돌려 준다 — 초대된 사람의 알림에는 넣지 않는다.
      const requestId =
        typeof rawRequestId === "string" && rawRequestId.length > 0 && rawRequestId.length <= 64
          ? rawRequestId
          : null;
      const id = asString(channelId);
      if (!id) return fail(null, "invalid");
      const npcIds = asStringArray(rawNpcIds);
      // NPC 가 없는 방은 사람만 있는 빈 방이다 — 이 기능의 목적이 아니고, 만들어 두면
      // 무엇을 지명해도 아무도 대답하지 않는 죽은 방이 목록에 쌓인다.
      if (npcIds.length === 0) return fail(null, "invalid");
      if (!(await channelAllowed(id))) return fail(null, "forbidden");

      const userIds = asStringArray(rawUserIds);
      const room = await rooms.createRoom({
        channelId: id,
        name: typeof name === "string" ? name : "",
        createdBy: user.userId,
        npcIds,
        userIds,
      });
      const summary = await summaryFor(id, room.id);
      if (!summary) return fail(room.id, "not_found");

      socket.emit("room:created", requestId ? { room: summary, requestId } : { room: summary });
      for (const socketId of socketIdsForUsers(new Set(userIds))) {
        roomIo.to(socketId).emit("room:created", { room: summary });
      }
    },

    async invite(payload) {
      const {
        roomId,
        npcIds: rawNpcIds,
        userIds: rawUserIds,
      } = (payload ?? {}) as { roomId?: unknown; npcIds?: unknown; userIds?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");
      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);
      // 사무실 방의 멤버는 출근부가 정한다 — 여기서 손대면 두 개의 정본이 생긴다.
      if (access.room.kind !== "group") return fail(id, "invalid");

      const npcIds = asStringArray(rawNpcIds);
      const userIds = asStringArray(rawUserIds);
      if (npcIds.length === 0 && userIds.length === 0) return fail(id, "invalid");

      const before = await summaryFor(access.room.channelId, id);
      const beforeKeys = new Set((before?.members ?? []).map(memberKey));

      await rooms.addMembers(id, user.userId, npcIds, userIds);
      // 참가자 명단이 바뀌었다 — 런타임은 만들어질 때의 명단을 들고 살기 때문에
      // 버리지 않으면 새 멤버는 불러도 오지 않는다.
      invalidateRuntime(id);

      const after = await summaryFor(access.room.channelId, id);
      if (!after) return fail(id, "not_found");
      const added = after.members.filter((m) => !beforeKeys.has(memberKey(m)));
      if (added.length > 0) {
        await appendSystemMessage(id, { kind: "invited", names: added.map((m) => m.name) });
      }
      roomIo.to(socketRoom(id)).emit("room:updated", { room: after });
      // 새로 초대된 사람은 아직 이 소켓 룸에 없다 — 방이 있다는 사실 자체를 밀어 준다.
      for (const socketId of socketIdsForUsers(new Set(userIds))) {
        roomIo.to(socketId).emit("room:created", { room: after });
      }
    },

    async leave(payload) {
      const { roomId } = (payload ?? {}) as { roomId?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");
      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);
      // 사무실 방은 나갈 수 없다 — 채널에 있는 한 언제나 보이는 기본 방이다.
      if (access.room.kind !== "group") return fail(id, "invalid");

      const before = await summaryFor(access.room.channelId, id);
      const myName =
        before?.members.find((m) => m.kind === "user" && m.id === user.userId)?.name ??
        user.nickname;

      await rooms.removeUserMember(id, user.userId);
      invalidateRuntime(id);

      await appendSystemMessage(id, { kind: "left", name: myName });
      if (before) {
        roomIo.to(socketRoom(id)).emit("room:updated", {
          room: {
            ...before,
            members: before.members.filter((m) => !(m.kind === "user" && m.id === user.userId)),
          },
        });
      }
      openRooms.delete(id);
      socket.leave(socketRoom(id));
      // 나간 사람에게는 방이 사라진 것과 같다. 목록에서 지우라고 알린다.
      socket.emit("room:deleted", { roomId: id });
    },

    async rename(payload) {
      const { roomId, name } = (payload ?? {}) as { roomId?: unknown; name?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");
      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);
      if (access.room.kind !== "group") return fail(id, "invalid");
      // 개명·삭제는 만든 사람만 — 멤버 전원이 할 수 있으면 남의 방 이름이 계속 바뀐다.
      if (access.room.createdBy !== user.userId) return fail(id, "forbidden");

      const next = String(name ?? "")
        .trim()
        .slice(0, 60);
      if (!next) return fail(id, "invalid");

      await rooms.renameRoom(id, next);
      await appendSystemMessage(id, { kind: "renamed", name: next });
      const summary = await summaryFor(access.room.channelId, id);
      if (summary) roomIo.to(socketRoom(id)).emit("room:updated", { room: summary });
    },

    async delete(payload) {
      const { roomId } = (payload ?? {}) as { roomId?: unknown };
      const id = asString(roomId);
      if (!id) return fail(null, "invalid");
      const access = await resolveAccess(id);
      if (!access.ok) return fail(id, access.code);
      if (access.room.kind !== "group") return fail(id, "invalid");
      if (access.room.createdBy !== user.userId) return fail(id, "forbidden");

      await rooms.deleteRoom(id);
      invalidateRuntime(id);
      openRooms.delete(id);
      roomIo.to(socketRoom(id)).emit("room:deleted", { roomId: id });
      socket.leave(socketRoom(id));
    },
  };

  socket.on("room:list", (p) => handlers.list(p));
  socket.on("room:open", (p) => handlers.open(p));
  socket.on("room:close", (p) => handlers.close(p));
  socket.on("room:send", (p) => handlers.send(p));
  socket.on("room:create", (p) => handlers.create(p));
  socket.on("room:invite", (p) => handlers.invite(p));
  socket.on("room:leave", (p) => handlers.leave(p));
  socket.on("room:rename", (p) => handlers.rename(p));
  socket.on("room:delete", (p) => handlers.delete(p));

  return handlers;
}
