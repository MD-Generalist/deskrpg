// 방 하나의 자유채팅 런타임. 예전 `createOpenChat`(채널당 하나)을 방 단위로 옮긴 것이다.
//
// 채널당 하나였을 때는 참가자가 "이 채널의 출근 NPC 전부" 하나뿐이었다. 방이 생기면서
// 두 갈래가 된다 — 사무실 방은 그대로 채널 전원이고, 그룹 방은 그 방의 NPC 멤버만이다.
// 세션 스코프도 방마다 갈라야 한다(`room-<id>`): 같은 NPC 가 두 방에서 같은 세션을 쓰면
// 한 방의 대화가 다른 방 프롬프트에 섞인다.

import type { Server } from "socket.io";
import { OpenChatRuntime } from "@/lib/conversation/open-chat-runtime";
import type { OpenChatCallbacks, OpenChatDeps } from "@/lib/conversation/open-chat-runtime";
import type { EngineParticipant } from "@/lib/conversation/types";
import type { ChatLine } from "@/lib/open-chat-formatter";
import { decideResponders } from "@/lib/chat-rooms-policy";
import { appendRoomMessage, recentRoomMessages, roomNpcMemberIds } from "@/lib/chat-rooms";
import type { RoomRow } from "@/lib/chat-rooms";
import { resolveNpcAdapter } from "./meeting-discussion";
import { getOrCreateCached } from "./promise-cache";
import { adapterRegistry, getNpcConfigsForChannel } from "./socket-handlers";

/** 프롬프트에 실을 최근 대화 줄 수. 예전 채널 히스토리의 `slice(-10)` 과 같다. */
const RECENT_LIMIT = 10;

/**
 * `OpenChatDeps.recent()` 는 **동기**다. 메시지는 이제 메모리 배열이 아니라 DB 에 있으므로
 * 생성 시점에 마지막 몇 줄을 읽어 두고, 이후는 오가는 말마다 밀어 넣어 최신으로 유지한다.
 *
 * 중복 판정은 **메시지 id** 로 한다. 내용으로 가르면 "네" 를 3초 간격으로 두 번 보낸 사람의
 * 두 번째 말이 프롬프트에서 조용히 사라진다 — 쿨다운은 2초뿐이라 정당한 반복이다.
 */
type RecentEntry = { id: string; sender: string; content: string };

class RecentCache {
  private entries: RecentEntry[] = [];

  seed(entries: RecentEntry[]) {
    this.entries = entries.slice(-RECENT_LIMIT);
  }

  push(id: string, sender: string, content: string) {
    if (this.entries.some((e) => e.id === id)) return;
    this.entries.push({ id, sender, content });
    if (this.entries.length > RECENT_LIMIT) this.entries = this.entries.slice(-RECENT_LIMIT);
  }

  read(): ChatLine[] {
    return this.entries.map(({ sender, content }) => ({ sender, content }));
  }
}

/**
 * DB 의 최근 줄을 캐시가 먹을 수 있는 모양으로. 시스템 메시지는 JSON 구조라 뺀다.
 *
 * **거르고 나서 자른다.** 10줄만 읽어 놓고 거기서 시스템 메시지를 빼면, 초대·개명이
 * 잦았던 방은 대본에 실리는 대화가 그만큼 줄어든다. 넉넉히 읽어 거른 뒤 꼬리를 자른다.
 */
async function loadRecentEntries(roomId: string): Promise<RecentEntry[]> {
  return (await recentRoomMessages(roomId, RECENT_LIMIT * 3))
    .filter((m) => m.senderKind !== "system")
    .slice(-RECENT_LIMIT)
    .map((m) => ({ id: m.id, sender: m.senderName, content: m.content }));
}

/**
 * 사람의 말은 소켓 계층이 **먼저 DB 에 저장한 뒤** 이 런타임을 깨운다 — 그래서 사람의 턴이
 * 열릴 때마다 DB 꼬리를 다시 읽어 캐시를 맞춘다. 사람 메시지의 id 를 인자로 받지 않고도
 * 정확하고, 다른 소켓이 그 사이에 넣은 말도 함께 따라온다. NPC 의 답은 `onTurnEnd` 가
 * id 와 함께 밀어 넣으므로 한 사슬 안에서는 DB 를 다시 읽지 않는다.
 */
class RoomChatRuntime extends OpenChatRuntime {
  private readonly recent: RecentCache;
  private readonly roomId: string;

  constructor(
    recent: RecentCache,
    roomId: string,
    deps: OpenChatDeps,
    callbacks: OpenChatCallbacks,
  ) {
    super(deps, callbacks);
    this.recent = recent;
    this.roomId = roomId;
  }

  override async handleHumanMessage(
    senderName: string,
    text: string,
    callerSocketId: string | null = null,
  ): Promise<void> {
    try {
      this.recent.seed(await loadRecentEntries(this.roomId));
    } catch (err) {
      // 프롬프트가 조금 낡을 뿐이라 턴 자체를 막지는 않는다.
      console.error("[room] failed to refresh recent cache:", err);
    }
    await super.handleHumanMessage(senderName, text, callerSocketId);
  }
}

/**
 * 방별 런타임. 값이 런타임이 아니라 **약속**인 이유는 채널 버전과 같다 — 생성이 두 번의
 * DB 왕복을 거치는 동안 들어온 두 번째 지명이 두 번째 인스턴스를 만들면 speaking 가드도
 * 예산도 인스턴스별이라 동시에 무력화된다.
 */
const roomRuntimes = new Map<string, Promise<OpenChatRuntime | null>>();
/** roomId → channelId. 채널 단위 무효화(NPC 고용·해고)가 어느 방을 버릴지 알아야 한다. */
const roomChannels = new Map<string, string>();

/**
 * 어댑터 해석과 NPC 명단 조회의 주입점. 기본값이 실제 배선이다 — 테스트가 게이트웨이나
 * CLI 없이 이 파일의 조립 규칙(참가자 거르기·정책 배선·캐시·콜백)을 관찰하기 위한 것이다.
 */
export type RoomRuntimeDeps = {
  getNpcConfigs?: typeof getNpcConfigsForChannel;
  resolveAdapter?: typeof resolveNpcAdapter;
};

export function getOrCreateRoomRuntime(
  io: Server,
  room: RoomRow,
  callerUserId: string,
  deps: RoomRuntimeDeps = {},
): Promise<OpenChatRuntime | null> {
  roomChannels.set(room.id, room.channelId);
  return getOrCreateCached(roomRuntimes, room.id, () =>
    createRoomRuntime(io, room, callerUserId, deps),
  );
}

/** 멤버가 바뀌거나 방이 사라지면 부른다. 다음 지명에서 DB 를 다시 읽어 새로 만든다. */
export function invalidateRoomRuntime(roomId: string): void {
  roomRuntimes.delete(roomId);
  roomChannels.delete(roomId);
}

/**
 * 채널의 NPC 명단이 바뀌었다(고용·수정·해고) — 그 채널의 방 런타임을 전부 버린다.
 * 사무실 방은 채널 전원을 참가자로 잡고 그룹 방도 해고된 NPC 를 멤버로 들고 있을 수
 * 있으므로, 방 하나만 버리면 나머지가 유령 NPC 를 계속 부른다.
 */
export function invalidateRoomRuntimesForChannel(channelId: string): void {
  for (const [roomId, id] of roomChannels) {
    if (id === channelId) invalidateRoomRuntime(roomId);
  }
}

async function createRoomRuntime(
  io: Server,
  room: RoomRow,
  callerUserId: string,
  deps: RoomRuntimeDeps,
): Promise<OpenChatRuntime | null> {
  const loadNpcConfigs = deps.getNpcConfigs ?? getNpcConfigsForChannel;
  const resolveAdapter = deps.resolveAdapter ?? resolveNpcAdapter;
  const npcConfigs = await loadNpcConfigs(room.channelId);
  // 사무실 방은 채널의 출근 NPC 전부, 그룹 방은 초대된 NPC 만.
  const allowed = room.kind === "group" ? new Set(await roomNpcMemberIds(room.id)) : null;
  const candidates = allowed ? npcConfigs.filter((npc) => allowed.has(npc.id)) : npcConfigs;

  const participants: EngineParticipant[] = [];
  for (const npc of candidates) {
    const resolved = await resolveAdapter(npc, {
      sessionScope: `room-${room.id}`,
      userId: callerUserId,
      adapterRegistry,
    });
    if ("excluded" in resolved) continue;
    participants.push({
      npcId: resolved.participant.npcId,
      displayName: resolved.participant.displayName,
      seated: true,
      turnCount: 0,
      lastSpokeAt: 0,
      adapter: resolved.adapter,
      sessionKey: resolved.sessionKey,
      role: resolved.participant.role,
      passPolicy: resolved.participant.passPolicy,
      instructions: resolved.participant.instructions ?? null,
    });
  }
  if (participants.length === 0) return null;

  const recent = new RecentCache();
  recent.seed(await loadRecentEntries(room.id));

  const memberNpcIds = participants.map((p) => p.npcId);
  const socketRoom = `room-${room.id}`;

  return new RoomChatRuntime(
    recent,
    room.id,
    {
      participants,
      recent: () => recent.read(),
      turnTimeout: { idleMs: 180_000, maxMs: 600_000 },
      // 사무실(mention)은 지명만, 그룹(members)은 지명이 없으면 멤버 전원이 답한다.
      selectResponders: (mentioned) => decideResponders(room.replyPolicy, mentioned, memberNpcIds),
    },
    {
      onTurnStart: (npcId, _displayName, callerSocketId) => {
        // 걷기와 말하기는 동시에 시작한다 — 도착을 기다리지 않는다. targetPlayerId 가
        // 진짜 소켓 id 여야 클라이언트가 A* 를 돌린다(null 이면 아무도 걷지 않는다).
        if (!callerSocketId) return;
        // NPC 이동은 맵 전체가 봐야 하므로 채널 룸으로 나간다. roomId 를 함께 실어
        // 클라이언트가 "지금 보고 있는 방의 호출인가" 를 가른다.
        io.to(room.channelId).emit("npc:come-to-player", {
          npcId,
          targetPlayerId: callerSocketId,
          reason: "map-chat",
          roomId: room.id,
        });
      },
      onTurnEnd: (npcId, fullResponse, meta) => {
        const npc = participants.find((x) => x.npcId === npcId);
        if (meta?.aborted || !fullResponse) {
          // 맵에는 스트리밍 말풍선이 없어서 실패가 곧 무음이다 — 신호를 하나 쏜다.
          io.to(socketRoom).emit("room:npc-aborted", {
            roomId: room.id,
            npcId,
            npcName: npc?.displayName || npcId,
            reason: meta?.reason || "empty_response",
          });
          return;
        }
        void (async () => {
          const message = await appendRoomMessage({
            roomId: room.id,
            senderKind: "npc",
            senderId: npcId,
            senderName: npc?.displayName || npcId,
            content: fullResponse,
          });
          recent.push(message.id, message.senderName, message.content);
          io.to(socketRoom).emit("room:message", { roomId: room.id, message });
        })().catch((err) => console.error("[room] failed to persist npc message:", err));
      },
      onMentionSkipped: (npcId, reason) => {
        const npc = participants.find((x) => x.npcId === npcId);
        io.to(socketRoom).emit("room:mention-skipped", {
          roomId: room.id,
          npcId,
          npcName: npc?.displayName || npcId,
          reason,
        });
      },
      onMentionNoMatch: (callerSocketId) => {
        // 아무 멤버에도 안 맞는 지목 — 부른 사람에게만 알린다(방 전체에 뿌리지 않는다).
        const target = callerSocketId ? io.to(callerSocketId) : io.to(socketRoom);
        target.emit("room:mention-skipped", { roomId: room.id, reason: "no_match" });
      },
      onError: (err, npcId) => {
        console.error("[room]", room.id, npcId, err);
      },
    },
  );
}
