import { broadcastNpcUpdate } from "./npc-update-broadcast";
import { mapContentRevision } from "../lib/channel-map-revision";
import { createChannelMapRefresh } from "./channel-map-refresh";
import { registerMapRefreshHandler } from "../lib/channel-map-refresh";
import { effectiveMapSpawn, isCreativeStudioMap } from "../lib/effective-map-spawn";
import {
  PlayerResumeStore,
  readPlayerDestination,
  type PlayerDestination,
} from "./player-resume-state";
import { setNpcActive } from "../lib/npc-roster";
import { getMyCharacter, isMyCharacter, type MyCharacter } from "../lib/my-character";
import { createNpcCoordination } from "./npc-coordination";
import {
  createMeetingSpatialCoordinator,
  type MeetingSpatialCoordinator,
} from "./meeting-spatial-coordinator";
import { deriveChannelMotionLayout, closestValidUnoccupiedSpawn } from "./channel-motion-layout";
import { ChatResponseTracker, SessionQueue } from "./chat-response-tracker";
import { runTrackedDm, executeDmAdapter } from "./dm-response-runtime";
import { Server, Socket } from "socket.io";
import type { NpcAdapter } from "../lib/adapters/types";
import { jwtVerify } from "jose";
import { eq, and } from "drizzle-orm";
import {
  db,
  channels,
  channelMembers,
  characters,
  groupMembers,
  meetingMinutes,
  chatMessages,
  jsonForDb,
} from "../db";
import { describeActivity } from "@/lib/npc-activity";
import { readLocaleCookie } from "@/lib/i18n/server";
import { composeNpcInstructions } from "@/lib/npc-prompt-layers";
import { getDefaultMeetingProtocol } from "@/lib/npc-agent-defaults";
import {
  appendNpcChatMessage,
  characterBelongsToUser,
  clearNpcChatHistory,
  loadDmThreads,
  loadNpcChatHistory,
  npcHistoryKey,
  pickHistoryCharacterId,
  type NpcHistoryMessage,
} from "@/lib/npc-chat-history";
import {
  extractFileContent,
  buildFilePromptSection,
  buildAttachments,
  isAllowedFileType,
  FILE_LIMITS,
} from "@/lib/file-extractor";
import type { ExtractedFile, GatewayAttachment } from "@/lib/file-extractor";

const DEBUG_CHAT = process.env.DEBUG_CHAT === "1" || process.env.DEBUG_CHAT === "true";
function chatLog(...args: unknown[]) {
  if (DEBUG_CHAT) console.log("[npc:chat]", ...args);
}

import { selectChannelNpcs, selectNpcById } from "../lib/npc-projection";
import { registerNpcRosterHandlers } from "./npc-roster-socket";
import {
  buildChannelAccessDeniedPayload,
  type ChannelAccessDeniedReason,
  summarizeChannelParticipationAccess,
} from "../lib/rbac/channel-access";
import { gatewayFailureMessageCode } from "../lib/hermes/classify-gateway-failure";
import { type NpcResponseMessageCode, type NpcResponsePayload } from "../lib/npc-response-messages";
import {
  deliverMeetingNpcAnswer,
  emitMeetingNpcStream,
  registerMeetingSocketHandlers,
} from "./meeting-socket";
import {
  registerMeetingDiscussionHandlers,
  resolveNpcAdapter,
  settleMeeting,
} from "./meeting-discussion";
import { createResummarizer } from "./meeting-resummarize";
import { registerRoomHandlers } from "./room-socket";
import { normalizeOfficeAppearance } from "@/game/three/office-appearance";
import { AUTOMATION_SOCKET_EVENTS, getWorkingSnapshot } from "./automation-events";
import { setChannelActive, startAutomationPollers } from "./automation-poller";
import {
  getOrCreateRoomRuntime,
  invalidateRoomRuntime,
  invalidateRoomRuntimesForChannel,
} from "./room-runtime";
import * as chatRooms from "@/lib/chat-rooms";
import {
  buildMeetingSummaryPrompt,
  parseMeetingOutcome,
  type MeetingOutcome,
  type MeetingSummaryStatus,
  type OutcomeParticipant,
  type ParsedMeetingOutcome,
} from "@/lib/meeting-outcome";
import { announceMeetingOutcome } from "@/lib/meeting-outcome-notice";
import { registerMeetingHooks } from "@/lib/meeting-registry";
import { prefixReportFormat } from "@/lib/report-format";
import { prefixUserContext, type UserContext } from "@/lib/user-context";
import { AdapterRegistry } from "../lib/adapters/types.js";
import { ClaudeAdapter } from "../lib/adapters/claude-adapter.js";
import { CodexAdapter } from "../lib/adapters/codex-adapter.js";
import { GeminiAdapter } from "../lib/adapters/gemini-adapter.js";
import { OpencodeAdapter as OpenCodeAdapter } from "../lib/adapters/opencode-adapter.js";
import {
  classifyNpcDispatch,
  clearHermesRun,
  createHermesAdapterForNpc,
  deriveHermesContextKey,
  persistHermesSessionRef,
  registerHermesRun,
} from "./hermes-dispatch";

export const adapterRegistry = new AdapterRegistry();

// Register CLI adapters when the corresponding local CLI is installed.
for (const AdapterClass of [ClaudeAdapter, CodexAdapter, GeminiAdapter, OpenCodeAdapter]) {
  const adapter = new AdapterClass();
  void adapter
    .testConnection({})
    .then((result) => {
      if (result.status === "ok") {
        adapterRegistry.register(adapter);
        console.log("[adapters] Registered", adapter.type, "adapter (", result.version, ")");
      }
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: string; // socket.id
  userId: string;
  characterId: string;
  characterName: string;
  appearance: unknown;
  mapId: string;
  x: number;
  y: number;
  direction: string;
  animation: string;
  motion?: PlayerDestination | null;
}

interface NpcConfig {
  id: string;
  name: string;
  agentId: string | null;
  sessionKeyPrefix: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  hermesProfileId: string | null;
  _channelId: string;
  _name: string;
  role?: string | null;
  passPolicy?: string | null;
  /** 이 NPC 의 회의 발언 규칙. 없으면 로케일 기본값을 쓴다. */
  meetingProtocol?: string | null;
  /** 프롬프트 문서의 언어. 태스크 절차를 그 언어로 만든다. */
  locale?: string | null;
  /**
   * 이 NPC 의 턴에 실을 시스템 지시. getNpcConfig* 가 층을 조립해 채운다 —
   * 호출부는 계산하지 않고 이 필드만 읽는다. 1:1·회의·채널 멘션이 같은 값을 쓴다.
   */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Meeting room types
// ---------------------------------------------------------------------------

interface MeetingMessage {
  id: string;
  sender: string;
  senderId: string;
  senderType: "user" | "npc";
  content: string;
  timestamp: number;
}

interface MeetingRoom {
  participants: Set<string>;
  messages: MeetingMessage[];
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const players = new Map<string, PlayerState>();
const playerResumeStates = new PlayerResumeStore();

// Rate limit: socketId -> last message timestamp
const lastChatTime = new Map<string, number>();

// Meeting rooms: channelId -> MeetingRoom
const meetingRooms = new Map<string, MeetingRoom>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeBrokers = new Map<string, any>();
const discussionInitiators = new Map<string, string>();

// NPC chat history: `${characterId}:${npcId}` -> messages.
// 정본은 chat_messages 테이블이고 이 맵은 그 앞의 캐시다 — 프로세스가 죽으면 비지만,
// 다음 조회에서 DB 로부터 다시 채워진다. 키는 npcHistoryKey() 하나로만 만든다.
const npcChatHistory = new Map<string, NpcHistoryMessage[]>();
const dmResponseQueue = new SessionQueue(8);
const dmResetting = new Set<string>();
const dmResponseTrackers = new Map<string, ChatResponseTracker>();
const dmResponseScope = (userId: string, characterId: string, npcId: string) =>
  `dm-response:${userId}:${characterId}:${npcId}`;
function getDmResponseTracker(io: Server, scope: string): ChatResponseTracker {
  const existing = dmResponseTrackers.get(scope);
  if (existing) return existing;
  // Evict only idle scopes; never lose the state of work currently queued/running.
  if (dmResponseTrackers.size >= 256) {
    const idle = [...dmResponseTrackers].find(([, tracker]) =>
      tracker
        .snapshot()
        .every((r) => r.status === "complete" || r.status === "failed" || r.status === "cancelled"),
    );
    if (!idle) throw new Error("queue_full");
    dmResponseTrackers.delete(idle[0]);
  }
  const tracker = new ChatResponseTracker((response) =>
    io.to(scope).emit("npc:response-state", { response }),
  );
  dmResponseTrackers.set(scope, tracker);
  return tracker;
}

// Gateway connections: gatewayId -> gateway instance

const CHAT_COOLDOWN_MS = 2000;

function emitNpcSystemResponse(socket: Socket, npcId: string, messageCode: NpcResponseMessageCode) {
  const payload: NpcResponsePayload = {
    npcId,
    chunk: "",
    done: true,
    messageCode,
  };
  socket.emit("npc:response", payload);
}

// ---------------------------------------------------------------------------
// Cross-process bridge accessors (read-only)
//
// server.js runs Socket.io's connection handling entirely inside this
// module now, so its `players` map is private to this file. The internal
// HTTP bridges in server.js (loopback endpoints on SOCKET_PORT, used by
// Next.js API routes running in the same process) still need to answer
// "who is in this room" and "which socket(s) belong to this user" without
// server.js owning a second, permanently-empty copy of player state.
// ---------------------------------------------------------------------------

/** User IDs of players currently joined to a Socket.io room (channel). */
export function getRoomUserIds(io: Server, channelId: string): string[] {
  const roomSockets = io.sockets.adapter.rooms.get(channelId);
  if (!roomSockets) return [];

  const userIds: string[] = [];
  for (const socketId of roomSockets) {
    const player = players.get(socketId);
    if (player?.userId) userIds.push(player.userId);
  }
  return userIds;
}

/**
 * 채널 룸에 소켓이 하나라도 있는가 — 자동화 폴러의 주기(짧게/길게)를 정한다(R24).
 * `disconnect` 시점에는 소켓이 이미 룸에서 빠져 있으므로 그대로 세어도 맞다.
 */
function channelHasSockets(io: Server, channelId: string): boolean {
  return (io.sockets?.adapter?.rooms?.get(channelId)?.size ?? 0) > 0;
}

/** 폴러에 접속 유무를 알린다. 폴러 쪽 실패가 소켓 흐름을 막지 않도록 여기서 삼킨다. */
function notifyChannelActivity(io: Server, channelId: string) {
  void setChannelActive(channelId, channelHasSockets(io, channelId)).catch((err: unknown) => {
    console.warn(
      `[automation-poller] setChannelActive(${channelId}) failed:`,
      err instanceof Error ? err.message : err,
    );
  });
}

/** Socket IDs currently associated with a given user (across all channels). */
export function getSocketIdsForUser(userId: string): string[] {
  const socketIds: string[] = [];
  for (const player of players.values()) {
    if (player.userId === userId) socketIds.push(player.id);
  }
  return socketIds;
}

/**
 * Given all socket ids currently associated with a user and the socket id
 * that is joining right now, return the ids of prior sessions that must be
 * kicked to enforce single-session-per-user. Excludes the joining socket
 * itself (a socket must never kick its own connection).
 */
export function getSocketIdsToKick(existingSocketIds: string[], joiningSocketId: string): string[] {
  return existingSocketIds.filter((id) => id !== joiningSocketId);
}

/**
 * 이력에 한 줄 남긴다 — 캐시와 DB 양쪽에.
 *
 * DB 쓰기가 실패해도 대화는 끊지 않는다. 이력을 잃는 것과 대화가 멈추는 것 중에는
 * 앞이 낫다. 다만 조용히 넘기지 않고 로그를 남긴다 — 성공을 보고하는 실패를 만들지
 * 않기 위해서다.
 */
async function appendNpcHistoryMessage(
  characterId: string,
  npcId: string,
  content: string,
  role: "player" | "npc" = "npc",
  correlation?: { id: string; responseRequestId?: string },
) {
  if (!content.trim()) return null;

  const historyKey = npcHistoryKey(characterId, npcId);
  const history = npcChatHistory.get(historyKey) || [];
  const entry = { role, content, timestamp: Date.now(), ...correlation };
  if (!correlation) {
    history.push(entry);
    npcChatHistory.set(historyKey, history);
  }

  try {
    const persisted = await appendNpcChatMessage(
      db,
      { chatMessages },
      {
        characterId,
        npcId,
        role,
        content,
      },
    );
    if (correlation) {
      if (!persisted) throw new Error("message persistence returned no row");
      // Fetch the latest array: another queued source may have completed its write meanwhile.
      const current = npcChatHistory.get(historyKey) ?? [];
      current.push(entry);
      current.sort((a, b) => a.timestamp - b.timestamp);
      npcChatHistory.set(historyKey, current);
    }
  } catch (err) {
    console.error("[chat-history] failed to persist message", { characterId, npcId, role }, err);
    if (correlation) throw err;
  }
  return content;
}

/**
 * 이 소켓의 발화를 누구의 이력으로 남길지 정한다.
 *
 * join 이 끝난 소켓은 서버가 캐릭터를 알고 있으므로 그 값을 쓴다. `players` 에 없으면
 * (재연결 직후 join 이 다시 성립하기 전) 클라이언트가 실어 보낸 값을 쓰되, 정말 그
 * 사용자의 캐릭터인지 DB 로 확인한다 — 확인 없이 믿으면 남의 이력에 쓸 수 있다.
 */
async function resolveHistoryCharacterId(
  socket: Socket,
  userId: string,
  claimedCharacterId?: string | null,
): Promise<string | null> {
  const player = players.get(socket.id);
  const picked = pickHistoryCharacterId({
    joinedCharacterId: player?.characterId ?? null,
    claimedCharacterId: claimedCharacterId ?? null,
  });
  if (!picked.characterId) return null;
  if (!picked.needsVerification) return picked.characterId;

  try {
    const owned = await characterBelongsToUser(
      db,
      { characters },
      {
        characterId: picked.characterId,
        userId,
      },
    );
    if (!owned) {
      console.warn("[chat-history] rejected character claim", {
        socketId: socket.id,
        userId,
        claimed: picked.characterId,
      });
      return null;
    }
    return picked.characterId;
  } catch (err) {
    console.error("[chat-history] failed to verify character claim", err);
    return null;
  }
}

/** player:join 이 서버에서 확정한 이 소켓의 내 캐릭터 id. join 전이면 null. */
function myCharacterIdOf(socket: Socket): string | null {
  const id = socket.data.myCharacterId;
  return typeof id === "string" && id ? id : null;
}

/** player:join 이 심은 "이 사람이 누구인지"(이름·소개). join 전이면 null — 앞머리를 붙이지 않는다. */
function userContextOf(socket: { data?: Record<string, unknown> }): UserContext | null {
  const ctx = socket.data?.userContext as UserContext | undefined;
  return ctx && typeof ctx.name === "string" && ctx.name ? ctx : null;
}

// 예전에는 여기에 OpenClaw 게이트웨이 커넥션 풀(getOrConnectGateway /
// invalidateGatewayConnectionForChannel)이 있었다. 게이트웨이 런타임 상태의 진짜
// 무효화는 gateway-resources.ts 가 설정 변경 시점에 invalidateGatewayRuntimeState 로
// 직접 하므로, 이 풀이 사라져도 무효화가 빠지지 않는다.

// ---------------------------------------------------------------------------
// NPC config loader
// ---------------------------------------------------------------------------

/**
 * 새 고용 경로(`hireGatewayProfilesIntoChannel`·`hireProfileIntoBoundChannels`)는
 * `agent_config` 를 NULL 로 둔다 — 이름·외형·인격의 정본이 프로필로 옮겨갔기 때문이다.
 * 그래서 폴백이 없으면 이 릴리스 이후 만들어지는 모든 NPC 가 `<team-instructions>`
 * 없이 회의에 들어간다. 기존 행은 옛 `agent_config` 를 그대로 쓴다.
 *
 * 기본 규약에는 "응답 언어 계약" 이 붙는다. 그 언어는 **요청 시점에** 정한다:
 * 요청한 사용자의 화면 언어 → 직원의 `agent_config.locale` → 마지막에만 "en".
 * 예전에는 `agent_config.locale` 만 봐서, 그 값이 없는 새 직원은 한국어 오피스에서도
 * "모든 발언은 영어로" 라는 계약을 받았다. 사용자가 직접 쓴 `meetingProtocol` 은
 * 손대지 않는다 — 그 언어는 쓴 사람의 선택이다.
 * 회의·1:1·방 세 경로가 모두 이 함수 하나로 해석한다(경로별로 갈라지지 않게).
 */
export function resolveNpcInstructions(
  oc: Record<string, unknown>,
  requestLocale?: string | null,
): string | undefined {
  if (typeof oc.meetingProtocol === "string" && oc.meetingProtocol.trim()) {
    return composeNpcInstructions({ meetingProtocol: oc.meetingProtocol, taskConfirmation: true });
  }
  const locale = requestLocale || (typeof oc.locale === "string" ? oc.locale : undefined);
  return composeNpcInstructions({
    meetingProtocol: getDefaultMeetingProtocol(locale),
    taskConfirmation: true,
  });
}

/** 이 소켓을 연 사용자의 화면 언어. 쿠키가 없으면 null. */
function socketLocale(socket: Socket): string | null {
  return readLocaleCookie(socket.handshake.headers.cookie);
}

async function getNpcConfig(
  npcId: string,
  requestLocale?: string | null,
): Promise<NpcConfig | null> {
  try {
    // 이름은 프로필이 정본이다 — `npcs.name` 을 읽으면 프로필에서 이름을 바꾼 뒤에도
    // 옛 이름이 대화에 실린다. 투영이 이름·외형과 JSON 파싱을 한 번에 해 준다.
    const npc = await selectNpcById(npcId);
    if (!npc) return null;

    const oc = (npc.agentConfig ?? {}) as Record<string, unknown>;
    const adapterConfig = (npc.adapterConfig ?? {}) as Record<string, unknown>;

    return {
      id: npc.id,
      name: npc.name,
      agentId: (oc.agentId as string) || null,
      sessionKeyPrefix: (oc.sessionKeyPrefix as string) || npcId,
      adapterType: typeof npc.adapterType === "string" ? npc.adapterType : "openclaw",
      adapterConfig,
      hermesProfileId: typeof npc.hermesProfileId === "string" ? npc.hermesProfileId : null,
      _channelId: npc.channelId as string,
      _name: npc.name,
      role: "Participant",
      passPolicy: typeof oc.passPolicy === "string" ? oc.passPolicy : null,
      meetingProtocol: typeof oc.meetingProtocol === "string" ? oc.meetingProtocol : null,
      locale: typeof oc.locale === "string" ? oc.locale : null,
      instructions: resolveNpcInstructions(oc, requestLocale),
    };
  } catch (err) {
    console.error(`[npc] Failed to load config for ${npcId}:`, err);
    return null;
  }
}

export async function getNpcConfigsForChannel(
  channelId: string,
  requestLocale?: string | null,
): Promise<NpcConfig[]> {
  try {
    // 회의·자유채팅 참가자 명단이다. 자리 미정(맵 밖)은 남기고 휴면만 뺀다 —
    // 출근부에서 퇴근시킨 NPC 가 자유채팅에 계속 답하면 토글이 아무 효과가 없다.
    const rows = await selectChannelNpcs(channelId, { roster: true, includeDormant: false });

    return rows.map((npc) => {
      const oc = (npc.agentConfig ?? {}) as Record<string, unknown>;
      const adapterConfig = (npc.adapterConfig ?? {}) as Record<string, unknown>;
      return {
        id: npc.id,
        name: npc.name,
        agentId: (oc.agentId as string) || null,
        sessionKeyPrefix: (oc.sessionKeyPrefix as string) || npc.id,
        adapterType: typeof npc.adapterType === "string" ? npc.adapterType : "openclaw",
        adapterConfig,
        hermesProfileId: typeof npc.hermesProfileId === "string" ? npc.hermesProfileId : null,
        _channelId: channelId,
        _name: npc.name,
        meetingProtocol: typeof oc.meetingProtocol === "string" ? oc.meetingProtocol : null,
        locale: typeof oc.locale === "string" ? oc.locale : null,
        instructions: resolveNpcInstructions(oc, requestLocale),
        role: "Participant",
        passPolicy: typeof oc.passPolicy === "string" ? oc.passPolicy : null,
      };
    });
  } catch (err) {
    console.error(`[npc] Failed to load NPC configs for channel ${channelId}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Gateway streaming — 1:1 DM chat
// ---------------------------------------------------------------------------

async function streamNpcResponse(
  socket: Socket,
  npcId: string,
  npcConfig: NpcConfig,
  userId: string,
  message: string,
  attachments?: GatewayAttachment[],
  sessionKeyOverride?: string,
  emitEvent?: string,
  signal?: AbortSignal,
): Promise<string> {
  const { _channelId, sessionKeyPrefix, adapterType, hermesProfileId } = npcConfig;
  const responseEvent = emitEvent || "npc:response";
  const sessionKey = sessionKeyOverride || `${sessionKeyPrefix || npcId}-dm-${userId}`;
  // 대화 상대 한 줄과 보고 형식 규칙은 메시지 앞머리에 붙인다 — 시스템 프롬프트(instructions)는
  // 건드리지 않는다. 순서는 "누구와 말하는가" → "어떻게 보고하는가" → 실제 본문이다.
  const prompt = prefixUserContext(prefixReportFormat(message), userContextOf(socket));

  const dispatchKind = classifyNpcDispatch({ adapterType, hermesProfileId });

  if (dispatchKind === "unbound") {
    emitNpcSystemResponse(socket, npcId, "npc_unbound");
    return "";
  }

  if (dispatchKind === "hermes") {
    const adapter = await createHermesAdapterForNpc(
      npcId,
      userId,
      deriveHermesContextKey(sessionKey, sessionKeyPrefix || npcId),
    );
    if (!adapter) {
      emitNpcSystemResponse(socket, npcId, "npc_unbound");
      return "";
    }

    if (attachments?.some((a) => a.type === "image")) {
      socket.emit(responseEvent, {
        npcId,
        chunk: "",
        done: false,
        messageCode: "hermes_image_unsupported",
      });
    }

    try {
      const { response, session } = await executeDmAdapter(
        adapter,
        {
          sessionKey,
          prompt,
          instructions: npcConfig.instructions,
          onDelta: (delta: string) => {
            socket.emit(responseEvent, { npcId, chunk: delta, done: false });
          },
          // tool.progress 는 진행 신호이지 답변이 아니다. 그래서 **도구 이름만** 쓰고
          // delta 본문은 버린다 — 실측(v0.20.2)에서 `_thinking` 툴은 완성된 답변 전체를
          // delta 에 한 번 더 실어 보내는데, 예전에 이걸 채팅 청크로 흘리다가 1:1 대화에서
          // 답이 정확히 두 번 보였다. 본문 경로(onDelta)와 활동 경로를 아예 갈라 두었으니
          // 그 버그는 구조적으로 재발할 수 없다.
          onToolProgress: (toolName: string) => {
            // 빈 이름은 "도구가 끝났다"는 뜻이다(tool.completed) — 표시를 끈다.
            const notice = describeActivity(toolName);
            socket.emit("npc:activity", { npcId, activityKey: notice?.key ?? null });
          },
          onRunStarted: (runId: string) => {
            registerHermesRun(sessionKey, runId);
          },
        },
        undefined,
        signal,
      );
      socket.emit(responseEvent, { npcId, chunk: "", done: true });
      await persistHermesSessionRef(
        npcId,
        userId,
        deriveHermesContextKey(sessionKey, sessionKeyPrefix || npcId),
        session.sessionRef,
      );
      return response || "";
    } catch (err) {
      console.error("[npc] Hermes adapter error for " + npcId + ":", err);
      emitNpcSystemResponse(socket, npcId, gatewayFailureMessageCode(err));
      return "";
    } finally {
      clearHermesRun(sessionKey);
      // 성공이든 실패든 활동 표시는 반드시 끈다 — 남으면 "영원히 검색 중"이 된다.
      socket.emit("npc:activity", { npcId, activityKey: null });
    }
  }

  // dispatchKind === "registry"
  if (adapterRegistry.has(adapterType)) {
    const adapter = adapterRegistry.get(adapterType);

    try {
      const { response } = await executeDmAdapter(
        adapter,
        {
          sessionKey,
          prompt,
          instructions: npcConfig.instructions,
          attachments,
          model:
            typeof npcConfig.adapterConfig.model === "string"
              ? npcConfig.adapterConfig.model
              : undefined,
          onDelta: (delta: string) => {
            socket.emit(responseEvent, { npcId, chunk: delta, done: false });
          },
          timeoutMs: 180_000,
        },
        undefined,
        signal,
      );
      socket.emit(responseEvent, { npcId, chunk: "", done: true });
      return response || "";
    } catch (err) {
      console.error("[npc] CLI adapter error for " + npcId + ":", err);
      emitNpcSystemResponse(socket, npcId, gatewayFailureMessageCode(err));
      return "";
    }
  } else {
    emitNpcSystemResponse(socket, npcId, "unsupported_adapter");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Gateway streaming — meeting room broadcast
// ---------------------------------------------------------------------------

async function streamMeetingNpcResponse(
  io: Server,
  channelId: string,
  npcConfig: NpcConfig,
  room: MeetingRoom,
  userMessage: string,
  senderName: string,
  userId: string,
  userContext: UserContext | null,
): Promise<void> {
  const { id: npcId, agentId, sessionKeyPrefix, _name, adapterType, hermesProfileId } = npcConfig;
  const dispatchKind = classifyNpcDispatch({ adapterType, hermesProfileId });

  if (dispatchKind === "unbound") {
    emitMeetingNpcStream(io, channelId, {
      npcId,
      npcName: _name,
      chunk: "",
      done: true,
      messageCode: "npc_unbound",
    });
    return;
  }

  if (dispatchKind === "registry" && !adapterRegistry.has(adapterType)) {
    emitMeetingNpcStream(io, channelId, {
      npcId,
      npcName: _name,
      chunk: "",
      done: true,
      messageCode: "unsupported_adapter",
    });
    return;
  }

  // Skip openclaw NPCs without an assigned agent in meeting rooms (unchanged: silent no-op).
  if (dispatchKind === "openclaw" && !agentId) return;

  const sessionKey = `${sessionKeyPrefix || _name}-meeting-${channelId}`;
  // 발언한 사람의 이름·소개와 보고 형식을 앞머리에 붙인다(회의 상대는 발언자다).
  const prompt = prefixUserContext(
    prefixReportFormat(`${senderName}: ${userMessage}`),
    userContext,
  );

  let hermesAdapter: Awaited<ReturnType<typeof createHermesAdapterForNpc>> = null;
  let hermesContextKey = "";

  if (dispatchKind === "openclaw") {
    // OpenClaw 는 제거됐다. 이 어댑터로 남아 있는 NPC 는 회의에서 조용히 빠지는 대신
    // 다시 연결해야 한다는 것을 알린다.
    emitMeetingNpcStream(io, channelId, {
      npcId,
      npcName: _name,
      chunk: "",
      done: true,
      messageCode: "npc_unbound",
    });
    return;
  } else if (dispatchKind === "hermes") {
    hermesContextKey = deriveHermesContextKey(sessionKey, sessionKeyPrefix || _name);
    hermesAdapter = await createHermesAdapterForNpc(npcId, userId, hermesContextKey);
    if (!hermesAdapter) {
      emitMeetingNpcStream(io, channelId, {
        npcId,
        npcName: _name,
        chunk: "",
        done: true,
        messageCode: "npc_unbound",
      });
      return;
    }
  }

  const npcMessage: MeetingMessage = {
    id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: _name,
    senderId: `npc-${_name}`,
    senderType: "npc",
    content: "",
    timestamp: Date.now(),
  };

  room.messages.push(npcMessage);
  if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);

  // fullText는 onDelta 클로저보다 먼저 선언해야 한다 — 반대 순서는 오늘은 안전하지만
  // (execute 안에서만 호출된다) 리팩터 한 번이면 TDZ 함정이 된다.
  let fullText = "";
  const onDelta = (delta: string) => {
    fullText += delta;
    npcMessage.content = fullText;
    emitMeetingNpcStream(io, channelId, {
      npcId,
      npcName: _name,
      messageId: npcMessage.id,
      sender: _name,
      chunk: delta,
      done: false,
    });
  };

  /** hermes 분기에서만 채워진다 — 답변을 확정 전달한 뒤에 best-effort로 영속화한다(M6). */
  let persistSessionRef: (() => Promise<void>) | null = null;
  try {
    if (dispatchKind === "hermes") {
      const { response, session } = await hermesAdapter!.execute({
        sessionKey,
        prompt,
        instructions: npcConfig.instructions,
        onDelta,
        onRunStarted: (runId: string) => registerHermesRun(sessionKey, runId),
      });
      fullText = response || fullText;
      persistSessionRef = () =>
        persistHermesSessionRef(npcId, userId, hermesContextKey, session.sessionRef);
    } else {
      // dispatchKind === "registry"
      const adapter = adapterRegistry.get(adapterType);
      const { response } = await adapter.execute({
        sessionKey,
        prompt,
        instructions: npcConfig.instructions,
        model:
          typeof npcConfig.adapterConfig.model === "string"
            ? npcConfig.adapterConfig.model
            : undefined,
        onDelta,
        timeoutMs: 180_000,
      });
      fullText = response || fullText;
    }

    npcMessage.content = fullText;
    await deliverMeetingNpcAnswer({
      emitDone: () =>
        emitMeetingNpcStream(io, channelId, {
          npcId,
          npcName: _name,
          messageId: npcMessage.id,
          sender: _name,
          chunk: "",
          done: true,
        }),
      emitMessage: () => io.to(`meeting-${channelId}`).emit("meeting:message", npcMessage),
      persistSessionRef,
      onPersistError: (err) =>
        console.error(`[meeting] hermes session ref persist failed for NPC ${_name}:`, err),
    });
  } catch (err) {
    console.error(`[meeting] ${dispatchKind} error for NPC ${_name}:`, err);
    room.messages.pop();
  } finally {
    if (dispatchKind === "hermes") clearHermesRun(sessionKey);
  }
}

/**
 * 회의 요약. 참가자 어댑터 하나를 빌려 쓴다 — 백엔드가 무엇이든 상관없다.
 *
 * 예전에는 OpenClaw 게이트웨이의 chatSend 에 직접 매여 있었고, 호출부가
 * `gateway && openclawAgentId` 로 감싸고 있어서 Hermes 회의는 요약을 통째로 건너뛰었다.
 * 실패가 조용해서(빈 배열 + null) 회의록에 결론이 안 남는 것으로만 보였다.
 */
async function generateMeetingSummary(
  adapter: NpcAdapter,
  sessionKey: string,
  topic: string,
  transcript: string,
  participants: OutcomeParticipant[] = [],
): Promise<ParsedMeetingOutcome> {
  try {
    // multiParty: true — 요약은 그 NPC 의 영속 대화 세션이 아니라 일회성 실행이어야 한다.
    // 히스토리는 비운다; 트랜스크립트는 프롬프트에 이미 통째로 들어 있다.
    const { response } = await Promise.race([
      adapter.execute({
        sessionKey,
        prompt: buildMeetingSummaryPrompt(topic, transcript, participants),
        multiParty: true,
        conversationHistory: [],
      }),
      new Promise<{ response: string }>((_, reject) => {
        setTimeout(() => reject(new Error("Summary timeout")), 60_000);
      }),
    ]);
    // JSON 이 없거나 깨졌으면 `failed` 로 돌아온다 — 빈 값을 성공처럼 저장하지 않는다.
    return parseMeetingOutcome(response || "", participants);
  } catch (err) {
    console.warn("[meeting] Summary generation failed:", err);
    return { status: "failed", keyTopics: [], conclusions: null, outcome: null };
  }
}

async function canControlMeeting(channelId: string, userId: string) {
  if (discussionInitiators.get(channelId) === userId) {
    return true;
  }

  const rows = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  return rows[0]?.ownerId === userId;
}

async function persistMeetingMinutes(input: {
  channelId: string;
  topic: string;
  transcript: string;
  participants: Array<{ id: string; name: string; type: "npc" | "player"; agentId?: string }>;
  totalTurns: number;
  durationSeconds?: number;
  initiatorId: string | null;
  keyTopics: string[];
  conclusions: string | null;
  outcome?: MeetingOutcome | null;
  summaryStatus?: MeetingSummaryStatus;
}) {
  try {
    const inserted = await db
      .insert(meetingMinutes)
      .values({
        channelId: input.channelId,
        topic: input.topic,
        transcript: input.transcript,
        participants: jsonForDb(input.participants),
        totalTurns: input.totalTurns,
        durationSeconds: input.durationSeconds ?? null,
        initiatorId: input.initiatorId,
        keyTopics: jsonForDb(input.keyTopics),
        conclusions: input.conclusions,
        outcomeJson: input.outcome ? jsonForDb(input.outcome) : null,
        summaryStatus: input.summaryStatus ?? "ok",
      })
      .returning({ id: meetingMinutes.id });

    return inserted[0]?.id ?? null;
  } catch (err) {
    console.error("[meeting] Failed to save minutes:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

import { DEV_JWT_SECRET } from "@/lib/dev-constants";

function getJwtSecret() {
  const secret =
    process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? DEV_JWT_SECRET : "");
  if (!secret) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(secret);
}

async function authenticateSocket(
  socket: Socket,
): Promise<{ userId: string; nickname: string } | null> {
  const cookieHeader = socket.handshake.headers.cookie || "";
  try {
    const tokenCookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("token="));

    if (!tokenCookie) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[socket:auth] missing token cookie", {
          socketId: socket.id,
          transport: socket.conn.transport.name,
          hasCookieHeader: cookieHeader.length > 0,
          userAgent: socket.handshake.headers["user-agent"] || "",
        });
      }
      return null;
    }

    const rawTokenValue = tokenCookie.slice("token=".length);
    const normalizedToken = decodeURIComponent(rawTokenValue).replace(/^"|"$/g, "");

    const { payload } = await jwtVerify(normalizedToken, getJwtSecret());
    return {
      userId: payload.userId as string,
      nickname: payload.nickname as string,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[socket:auth] token verify failed", {
        socketId: socket.id,
        transport: socket.conn.transport.name,
        error: error instanceof Error ? error.message : String(error),
        cookiePreview: cookieHeader.slice(0, 120),
        userAgent: socket.handshake.headers["user-agent"] || "",
      });
    }
    return null;
  }
}

function emitChannelAccessDenied(
  socket: Socket,
  input: Parameters<typeof buildChannelAccessDeniedPayload>[0],
) {
  socket.emit("channel:access-denied", buildChannelAccessDeniedPayload(input));
}

async function getSocketChannelParticipationAccess(channelId: string, userId: string) {
  const channelRows = await db
    .select({
      id: channels.id,
      groupId: channels.groupId,
      isPublic: channels.isPublic,
      ownerId: channels.ownerId,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  const channel = channelRows[0];
  if (!channel) {
    return null;
  }

  const groupMembershipRows = channel.groupId
    ? await db
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, channel.groupId), eq(groupMembers.userId, userId)))
        .limit(1)
    : [];

  const channelMembershipRows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);

  const access = summarizeChannelParticipationAccess({
    groupId: channel.groupId,
    isPublic: channel.isPublic ?? true,
    hasActiveGroupMembership: groupMembershipRows.length > 0,
    isChannelMember: channel.ownerId === userId || channelMembershipRows.length > 0,
  });

  return { channel, access };
}

async function isChannelOwner(channelId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  return rows[0]?.ownerId === userId;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupSocketHandlers(io: Server) {
  const loadMotionLayout = async (channelId: string) => {
    const [[channel], channelNpcs] = await Promise.all([
      db
        .select({
          mapData: channels.mapData,
          mapConfig: channels.mapConfig,
        })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1),
      selectChannelNpcs(channelId),
    ]);
    const layout =
      channel &&
      deriveChannelMotionLayout(
        channel,
        channelNpcs
          .filter((npc) => npc.positionX !== null && npc.positionY !== null)
          .map((npc) => ({ id: npc.id, positionX: npc.positionX!, positionY: npc.positionY! })),
      );
    if (!layout) throw new Error("Channel motion layout unavailable");
    return {
      ...layout,
      spawn: effectiveMapSpawn(channel.mapData, channel.mapConfig),
      revision: mapContentRevision(channel.mapData),
      requiresRevision: isCreativeStudioMap(channel.mapData),
    };
  };
  const selectRuntimeNpc = async (npcId: string) => {
    const npc = await selectNpcById(npcId);
    if (!npc || !npc.active || npc.positionX === null || npc.positionY === null) return npc;
    const [channel] = await db
      .select({ mapData: channels.mapData })
      .from(channels)
      .where(eq(channels.id, npc.channelId))
      .limit(1);
    if (!channel || !isCreativeStudioMap(channel.mapData)) return npc;
    const layout = await loadMotionLayout(npc.channelId);
    const home = layout.npcs.find((home) => home.id === npcId);
    return home ? { ...npc, positionX: home.x / 32 - 0.5, positionY: home.y / 32 - 0.5 } : null;
  };
  const coordination = createNpcCoordination(io, {
    getPlayer: (id) => {
      const player = players.get(id);
      return player &&
        !mapRefresh.isPaused(player.mapId) &&
        !io.sockets.sockets.get(id)?.data.mapRefreshRequired
        ? player
        : undefined;
    },
    loadChannel: loadMotionLayout,
    onSpatialArrival: (channelId, actorId, generation) =>
      spatial.arrived(channelId, actorId, generation),
    onSpatialBlocked: (channelId, actorId, reason, generation) =>
      spatial.block(channelId, actorId, reason, generation),
    onSpatialPlayerArrival: (channelId, userId, socketId) =>
      spatial.playerArrived(channelId, userId, socketId),
    onSpatialPlayerBlocked: (channelId, userId) =>
      spatial.block(channelId, userId, "participant_left"),
  });
  const spatial: MeetingSpatialCoordinator = createMeetingSpatialCoordinator({
    ...coordination.spatial,
    publish: (state) => io.to(`meeting-${state.channelId}`).emit("meeting:spatial-state", state),
  });

  const mapRefresh = createChannelMapRefresh({
    pause: async (id) => {
      io.to(id).emit("map:refresh", { channelId: id, protocolVersion: 1, phase: "begin" });
    },
    reset: async (id) => {
      // 이전 맵의 집결·착석·복귀와 구독은 새 맵에서 다시 승인받는다.
      spatial.reset(id);
      activeBrokers.get(id)?.stop();
      activeBrokers.delete(id);
      discussionInitiators.delete(id);
      meetingRooms.get(id)?.participants.clear();
      io.in(`meeting-${id}`).socketsLeave(`meeting-${id}`);
      await coordination.reset(id);
      playerResumeStates.clearChannel(id);
      for (const [socketId, player] of players)
        if (player.mapId === id) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) socket.data.mapRefreshRequired = true;
          players.delete(socketId);
        }
    },
    ready: (id) => {
      io.to(id).emit("map:refresh", { channelId: id, protocolVersion: 1, phase: "ready" });
    },
  });
  const refreshChannelMap = async (
    action: "begin" | "finish",
    channelId: string,
    lease?: string,
  ) => {
    if (action === "begin") return mapRefresh.begin(channelId);
    await mapRefresh.finish(channelId, lease ?? "");
    return null;
  };
  registerMapRefreshHandler(refreshChannelMap);

  // 회의록의 "요약 다시 시도" 라우트가 어댑터에 닿는 길(`meeting-registry.ts`).
  registerMeetingHooks({
    resummarize: createResummarizer({
      getNpcConfigsForChannel,
      resolveAdapter: (npc, ctx) => resolveNpcAdapter(npc, { ...ctx, adapterRegistry }),
      generateMeetingSummary,
    }),
  });

  // 묶인 채널의 자동화 사건 폴러. 뜨지 못해도 채팅·이동은 되어야 하므로 실패는 로그만.
  void startAutomationPollers(io).catch((err: unknown) => {
    console.error("[automation-poller] failed to start:", err);
  });

  // 이 기능 이전에 자리 없이 만들어진 직원을 1회 이행한다. 멱등이고, 실패해도 부팅은 계속한다.
  void import("../lib/npc-seating")
    .then(({ placeAllUnplacedNpcs }) => placeAllUnplacedNpcs())
    .then((r) => {
      if (r.channels > 0) console.log("[seating] backfill", r);
    })
    .catch((err: unknown) => console.error("[seating] backfill failed:", err));

  io.on("connection", async (socket) => {
    const user = await authenticateSocket(socket);
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.use((packet, next) => {
      const player = players.get(socket.id);
      const mapId = packet[0] === "player:join" ? packet[1]?.mapId : player?.mapId;
      if (typeof mapId === "string" && mapRefresh.isPaused(mapId)) {
        if (packet[0] === "player:join")
          socket.emit("map:refresh", { channelId: mapId, protocolVersion: 1, phase: "ready" });
        return;
      }
      if (socket.data.mapRefreshRequired && packet[0] !== "player:join") return;
      next();
    });
    coordination.register(socket);

    // ----- player:join -----
    socket.on(
      "player:join",
      async (data: {
        /** 선택 — 보내면 내 캐릭터인지 검사만 한다. 이름·외형은 서버가 채운다. */
        characterId?: string;
        characterName?: string;
        appearance?: unknown;
        mapId: string;
        mapRevision?: string;
        x: number;
        y: number;
      }) => {
        const mapGeneration = mapRefresh.generation(data.mapId);
        const accessResult = await getSocketChannelParticipationAccess(data.mapId, user.userId);
        if (!accessResult) {
          socket.emit("channel:access-denied", {
            channelId: data.mapId,
            action: "player:join",
            reason: "forbidden",
            errorCode: "forbidden",
          });
          return;
        }

        if (!accessResult.access.allowed) {
          emitChannelAccessDenied(socket, {
            channelId: data.mapId,
            action: "player:join",
            reason: accessResult.access.reason as ChannelAccessDeniedReason,
          });
          return;
        }

        // "나" 는 서버가 정한다 — 클라이언트가 보낸 characterId·이름·외형은 믿지 않는다.
        // 남의 캐릭터 id 로 들어오면 그 캐릭터로 행세하게 되므로(이력·방송) 거절한다.
        // 거절은 아래 단일 세션 kick 보다 먼저라서 거절된 입장이 같은 사용자의 살아 있는
        // 세션을 끊지 못한다. 조회 실패도 거절로 접는다 — 던지면 클라이언트가 응답을 못 받고
        // 입장이 멈춘다.
        let mine: MyCharacter | null;
        try {
          mine = await getMyCharacter(user.userId);
        } catch (err) {
          console.error("[player:join] my character lookup failed:", err);
          mine = null;
        }
        if (!mine) {
          console.warn(`[player:join] rejected join without a character from user ${user.userId}`);
          socket.emit("channel:access-denied", {
            channelId: data.mapId,
            action: "player:join",
            reason: "forbidden",
            errorCode: "character_missing",
          });
          return;
        }
        if (data.characterId && !isMyCharacter(mine, data.characterId)) {
          console.warn(`[player:join] rejected character claim from user ${user.userId}`);
          socket.emit("channel:access-denied", {
            channelId: data.mapId,
            action: "player:join",
            reason: "forbidden",
            errorCode: "character_not_yours",
          });
          return;
        }
        socket.data.myCharacterId = mine.id;
        socket.data.userContext = { name: mine.name, bio: mine.bio };

        // Enforce single session per user — disconnect any prior session(s)
        // for this account now that the join is authorized and proceeding.
        const priorSocketIds = getSocketIdsToKick(getSocketIdsForUser(user.userId), socket.id);
        for (const prevSocketId of priorSocketIds) {
          const prevSocket = io.sockets.sockets.get(prevSocketId);
          if (prevSocket) {
            prevSocket.emit("session:kicked", {
              reason: "다른 위치에서 접속하여 현재 세션이 종료되었습니다.",
            });
            prevSocket.disconnect(true);
          }
          players.delete(prevSocketId);
        }

        if (!socket.connected || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
        const previousChannel = players.get(socket.id)?.mapId;
        if (previousChannel && previousChannel !== data.mapId) {
          await socket.leave(previousChannel);
          socket.to(previousChannel).emit("player:left", { id: socket.id });
          await coordination.left(socket, previousChannel);
          notifyChannelActivity(io, previousChannel);
        }
        const identity = { userId: user.userId, characterId: mine.id, mapId: data.mapId };
        const resume = playerResumeStates.get(identity);
        let spawn = resume ? { x: resume.x, y: resume.y } : { x: data.x, y: data.y };
        let restored = !!resume;
        let admittedMapRevision: string;
        try {
          if (!resume) {
            const [saved] = await db
              .select({ x: channelMembers.lastX, y: channelMembers.lastY })
              .from(channelMembers)
              .where(
                and(
                  eq(channelMembers.channelId, data.mapId),
                  eq(channelMembers.userId, user.userId),
                ),
              )
              .limit(1);
            if (
              saved?.x != null &&
              saved?.y != null &&
              Number.isFinite(saved.x) &&
              Number.isFinite(saved.y)
            ) {
              spawn = { x: saved.x, y: saved.y };
              restored = true;
            }
          }
          const layout = await loadMotionLayout(data.mapId);
          if (
            mapRefresh.isPaused(data.mapId) ||
            mapRefresh.generation(data.mapId) !== mapGeneration
          ) {
            socket.emit("map:refresh", {
              channelId: data.mapId,
              protocolVersion: 1,
              phase: "ready",
            });
            return;
          }
          const missingRevision =
            typeof data.mapRevision !== "string" || data.mapRevision.length === 0;
          if ((layout.requiresRevision || socket.data.mapRefreshRequired) && missingRevision) {
            // Old bundles understand join-error but not map:refresh. They must
            // bootstrap through a fresh channel GET before regaining authority.
            socket.emit("join-error");
            socket.disconnect(true);
            return;
          }
          if (!missingRevision && data.mapRevision !== layout.revision) {
            socket.emit("map:refresh", {
              channelId: data.mapId,
              protocolVersion: 1,
              phase: "ready",
            });
            return;
          }
          if (!restored && layout.spawn)
            spawn = { x: (layout.spawn.col + 0.5) * 32, y: (layout.spawn.row + 0.5) * 32 };
          const liveActors = await coordination.occupancy(data.mapId, socket.id);
          // No await between final allocation and players.set: concurrent joins see this slot.
          const occupied = Array.from(players.values()).filter(
            (player) => player.mapId === data.mapId && player.id !== socket.id,
          );
          const candidate = closestValidUnoccupiedSpawn({ ...layout, npcs: [] }, spawn, [
            ...occupied,
            ...liveActors,
          ]);
          if (
            mapRefresh.isPaused(data.mapId) ||
            mapRefresh.generation(data.mapId) !== mapGeneration
          ) {
            socket.emit("map:refresh", {
              channelId: data.mapId,
              protocolVersion: 1,
              phase: "ready",
            });
            return;
          }
          if (!candidate || !socket.connected) {
            socket.emit("join-error");
            return;
          }
          spawn = candidate;
          admittedMapRevision = layout.revision;
        } catch {
          socket.emit("join-error");
          return;
        }
        socket.data.mapRefreshRequired = false;
        socket.data.mapRevision = admittedMapRevision;
        const playerState: PlayerState = {
          id: socket.id,
          userId: user.userId,
          characterId: mine.id,
          characterName: mine.name,
          appearance: normalizeOfficeAppearance(mine.appearance),
          mapId: data.mapId,
          x: spawn.x,
          y: spawn.y,
          direction: resume?.direction ?? "down",
          animation: resume?.motion ? resume.animation : "idle",
          motion: resume?.motion ?? null,
        };

        players.set(socket.id, playerState);
        playerResumeStates.save(playerState);
        const admissionCurrent = () =>
          players.get(socket.id) === playerState &&
          socket.connected &&
          !socket.data.mapRefreshRequired &&
          !mapRefresh.isPaused(data.mapId) &&
          mapRefresh.generation(data.mapId) === mapGeneration;
        await socket.join(data.mapId);
        if (!admissionCurrent()) return;
        socket.emit("player:spawn", {
          ...spawn,
          direction: playerState.direction,
          animation: playerState.animation,
          restored,
          motion: playerState.motion,
        });
        await coordination.joined(socket, data.mapId);
        if (!admissionCurrent()) return;

        // 자동화 맵 상태의 현재 값을 이 소켓에만 한 번(R27). 작업 중인 NPC 만 실린다 —
        // 클라이언트 기본값이 working:false 다. 이후 변화는 채널 방송으로 온다.
        for (const snapshot of getWorkingSnapshot(data.mapId)) {
          socket.emit(AUTOMATION_SOCKET_EVENTS.working, snapshot);
        }
        notifyChannelActivity(io, data.mapId);

        // Send current players on this map to the joining player
        const mapPlayers = Array.from(players.values()).filter(
          (p) => p.mapId === data.mapId && p.id !== socket.id,
        );
        socket.emit("players:state", { players: mapPlayers });

        // 방 목록은 서버가 밀지 않는다 — 클라이언트가 join 직후 room:list 를 부른다.
        // 어느 방을 열지는 클라이언트의 마지막 방 기억이 정하므로, 서버가 먼저 밀면
        // 그 판단보다 앞서 도착해 화면이 두 번 바뀐다.

        // Broadcast to others in the same map
        socket.to(data.mapId).emit("player:joined", playerState);
      },
    );

    // ----- player:move -----
    socket.on(
      "player:move",
      (data: { x: number; y: number; direction: string; animation: string; motion?: unknown }) => {
        const player = players.get(socket.id);
        if (!player) return;

        if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
        void coordination.moved(socket, data.x, data.y);
        player.x = data.x;
        player.y = data.y;
        player.direction = data.direction;
        player.animation = data.animation;
        player.motion = readPlayerDestination(data.motion);
        playerResumeStates.save(player);

        socket.to(player.mapId).emit("player:moved", {
          id: socket.id,
          x: data.x,
          y: data.y,
          direction: data.direction,
          animation: data.animation,
        });
      },
    );

    // ----- map:object-add (map editing broadcast, owner only) -----
    socket.on("map:object-add", async (data: unknown) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (!(await isChannelOwner(player.mapId, user.userId))) return;
      socket.to(player.mapId).emit("map:object-added", data);
    });

    // ----- map:object-remove (map editing broadcast, owner only) -----
    socket.on("map:object-remove", async (data: unknown) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (!(await isChannelOwner(player.mapId, user.userId))) return;
      socket.to(player.mapId).emit("map:object-removed", data);
    });

    // ----- map:tiles-update (map editing broadcast, owner only) -----
    socket.on("map:tiles-update", async (data: unknown) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (!(await isChannelOwner(player.mapId, user.userId))) return;
      socket.to(player.mapId).emit("map:tiles-updated", data);
    });

    socket.on("map:layout-saved", async () => {
      const player = players.get(socket.id);
      if (!player || !(await isChannelOwner(player.mapId, user.userId))) return;
      await coordination.invalidate(player.mapId);
    });

    // ----- npc:chat -----
    socket.on(
      "npc:chat",
      async (data: {
        npcId: string;
        message: string;
        characterId?: string;
        sourceMessageId?: string;
        files?: Array<{ name: string; type: string; size: number; data: ArrayBuffer }>;
      }) => {
        const { npcId, message, files } = data;
        chatLog(
          `← user msg to ${npcId}:`,
          message?.slice(0, 100),
          files
            ? `+${files.length} files [${files.map((f) => `${f.name}(${(f.size / 1024).toFixed(0)}KB)`).join(", ")}]`
            : "",
        );

        // Validate
        if (!npcId || !message || typeof message !== "string") return;
        const trimmed = message.trim().slice(0, 500);
        if (!trimmed && (!files || files.length === 0)) return;

        // Rate limit
        const now = Date.now();
        const lastTime = lastChatTime.get(socket.id) || 0;
        if (now - lastTime < CHAT_COOLDOWN_MS) {
          emitNpcSystemResponse(socket, npcId, "wait_before_sending");
          return;
        }
        lastChatTime.set(socket.id, now);

        // Load NPC config
        const npcConfig = await getNpcConfig(npcId, socketLocale(socket));
        if (!npcConfig) {
          emitNpcSystemResponse(socket, npcId, "npc_not_found");
          return;
        }

        const access = await getSocketChannelParticipationAccess(npcConfig._channelId, user.userId);
        const historyCharacterId = await resolveHistoryCharacterId(
          socket,
          user.userId,
          data.characterId,
        );
        if (!access?.access.allowed || !historyCharacterId) {
          emitNpcSystemResponse(socket, npcId, "npc_not_found");
          return;
        }
        const sourceMessageId =
          typeof data.sourceMessageId === "string" && data.sourceMessageId.length <= 100
            ? data.sourceMessageId
            : crypto.randomUUID();
        const requestId = crypto.randomUUID();
        const scope = dmResponseScope(user.userId, historyCharacterId, npcId);
        const queueKey = `${user.userId}:${npcId}`;
        try {
          if (dmResetting.has(queueKey) || dmResponseQueue.isFull(queueKey)) {
            emitNpcSystemResponse(socket, npcId, "wait_before_sending");
            return;
          }
          const tracker = getDmResponseTracker(io, scope);
          await socket.join(scope);
          await runTrackedDm({
            tracker,
            queue: dmResponseQueue,
            queueKey,
            identity: { requestId, sourceMessageId, npcId, npcName: npcConfig._name || npcId },
            prepare: () =>
              appendNpcHistoryMessage(historyCharacterId, npcId, trimmed, "player", {
                id: sourceMessageId,
              }),
            work: async (capture, isActive, signal) => {
              const responseSocket = new Proxy(socket, {
                get(target, property) {
                  if (property === "emit")
                    return (event: string, payload: Record<string, unknown>) => {
                      if (!isActive()) return target;
                      capture(event, payload);
                      target.emit(
                        event,
                        event === "npc:response" || event === "npc:activity"
                          ? { ...payload, responseRequestId: requestId }
                          : payload,
                      );
                      return target;
                    };
                  const value = Reflect.get(target, property, target);
                  return typeof value === "function" ? value.bind(target) : value;
                },
              });
              // --- File processing (text-based files only) ---
              let extractedFiles: ExtractedFile[] = [];
              let fileAttachments: GatewayAttachment[] | undefined;

              if (files && files.length > 0) {
                if (files.length > FILE_LIMITS.maxFileCount) {
                  emitNpcSystemResponse(responseSocket, npcId, "too_many_files");
                  return;
                }
                for (const f of files) {
                  if (f.size > FILE_LIMITS.maxFileSize) {
                    emitNpcSystemResponse(responseSocket, npcId, "file_too_large");
                    return;
                  }
                  if (!isAllowedFileType(f.name, f.type)) {
                    emitNpcSystemResponse(responseSocket, npcId, "unsupported_file_type");
                    return;
                  }
                }
                extractedFiles = await Promise.all(
                  files.map((f) => extractFileContent(Buffer.from(f.data), f.name, f.type)),
                );
                fileAttachments = buildAttachments(extractedFiles);
                chatLog(
                  "  extracted:",
                  extractedFiles
                    .map(
                      (f) =>
                        `${f.name}(text=${f.textContent?.length ?? 0}, img=${f.imageBase64 ? (f.imageBase64.length / 1024).toFixed(0) + "KB" : "-"}, trunc=${f.truncated})`,
                    )
                    .join(", "),
                );
              }

              const fileSection = buildFilePromptSection(extractedFiles);
              if (!isActive()) return;
              const messageToSend = trimmed + fileSection;

              // Stream response via OpenClaw
              chatLog(
                `  → gateway (${npcConfig._name}): msgLen=${messageToSend.length}(${(messageToSend.length / 1024).toFixed(0)}KB)`,
                fileAttachments
                  ? `+${fileAttachments.length} att(${fileAttachments.map((a) => `${a.fileName}:${(a.content.length / 1024).toFixed(0)}KB`).join(",")})`
                  : "",
              );
              const response = await streamNpcResponse(
                responseSocket,
                npcId,
                npcConfig,
                user.userId,
                messageToSend,
                fileAttachments,
                undefined,
                undefined,
                signal,
              );
              if (!isActive()) return;
              chatLog(
                `  ← npc response (${npcConfig._name}):`,
                response
                  ? response.slice(0, 150) + (response.length > 150 ? "..." : "")
                  : "(empty)",
              );
              if (response) {
                if (historyCharacterId) {
                  await appendNpcHistoryMessage(historyCharacterId, npcId, response, "npc", {
                    id: requestId,
                    responseRequestId: requestId,
                  });
                }
                responseSocket.emit("npc:response-complete", {
                  npcId,
                  npcName: npcConfig._name || npcId,
                });
              }
              return (response || "").trim();
            },
          });
        } catch (error) {
          console.error("[dm-response] unable to admit request", error);
          emitNpcSystemResponse(socket, npcId, gatewayFailureMessageCode(error));
        }
      },
    );

    // 이력의 주인은 player:join 에서 서버가 정한 내 캐릭터다. 클라이언트가 보낸 characterId 는
    // 무시한다 — join 전(socket.data.myCharacterId 없음)에는 빈 이력으로 답한다.
    socket.on("npc:history", async ({ npcId }: { npcId: string }) => {
      if (!npcId) return;
      const characterId = myCharacterIdOf(socket);
      if (!characterId) {
        socket.emit("npc:history", { npcId, messages: [] });
        return;
      }

      const historyKey = npcHistoryKey(characterId, npcId);
      let history = npcChatHistory.get(historyKey);
      if (!history) {
        // 캐시 미스 — 재시작 직후가 여기다. DB 가 정본이므로 거기서 채운다.
        try {
          history = await loadNpcChatHistory(db, { chatMessages }, { characterId, npcId });
          npcChatHistory.set(historyKey, history);
        } catch (err) {
          console.error("[chat-history] failed to load history", { characterId, npcId }, err);
          history = [];
        }
      }
      const scope = dmResponseScope(user.userId, characterId, npcId);
      await socket.join(scope);
      socket.emit("npc:history", { npcId, messages: history });
      socket.emit("npc:response-snapshot", {
        npcId,
        responses: dmResponseTrackers.get(scope)?.snapshot() ?? [],
      });
    });

    // 대화 목록의 DM 줄. 직원마다 마지막 발화 한 줄씩만 돌려준다 — 목록을 그리는 데
    // 필요한 것이 그뿐이고, 이름·출근 여부는 클라이언트가 이미 아는 출근부에서 붙인다.
    // 이력과 같은 규칙으로 주인을 정한다: join 전이면 빈 목록이다.
    socket.on("npc:dm-threads", async () => {
      const characterId = myCharacterIdOf(socket);
      if (!characterId) {
        socket.emit("npc:dm-threads", { threads: [] });
        return;
      }
      try {
        const threads = await loadDmThreads(db, { chatMessages }, { characterId });
        socket.emit("npc:dm-threads", { threads });
      } catch (err) {
        // 목록을 못 그리는 것이지 대화가 사라진 것은 아니다 — 조용히 넘기지 않고 남긴다.
        console.error("[chat-history] failed to load dm threads", { characterId }, err);
        socket.emit("npc:dm-threads", { threads: [] });
      }
    });

    socket.on("npc:reset-chat", async ({ npcId }: { npcId: string }) => {
      if (!npcId) return;
      const characterId = myCharacterIdOf(socket);
      if (!characterId) return;

      const scope = dmResponseScope(user.userId, characterId, npcId);
      const queueKey = `${user.userId}:${npcId}`;
      dmResetting.add(queueKey);
      try {
        dmResponseTrackers.get(scope)?.cancelAll();
        await dmResponseQueue.idle(queueKey);
        dmResponseTrackers.delete(scope);
        npcChatHistory.delete(npcHistoryKey(characterId, npcId));
        await clearNpcChatHistory(db, { chatMessages }, { characterId, npcId });
        socket.emit("npc:response-snapshot", { npcId, responses: [] });
      } catch (err) {
        console.error("[chat-history] failed to clear history", { characterId, npcId }, err);
      } finally {
        dmResetting.delete(queueKey);
      }
    });

    // NPC movement and seat ownership use the compatible channel coordinator above.

    // NPC management broadcasts (re-broadcast to room)
    //
    // 세 갈래 모두 그 채널의 방 런타임 캐시를 버린다. 런타임은 만들어질 때의 참가자
    // 목록을 계속 들고 있어서, 버리지 않으면 **해고된 NPC 가 계속 대답하고 새로 온 NPC 는
    // 불러도 오지 않는다.** 다음 지명에서 DB 를 다시 읽어 새로 만든다.
    socket.on("npc:broadcast-add", (npcData: unknown) => {
      const player = players.get(socket.id);
      if (!player) return;
      invalidateRoomRuntimesForChannel(player.mapId);
      void coordination.invalidate(player.mapId);
      socket.to(player.mapId).emit("npc:added", npcData);
    });

    socket.on("npc:broadcast-update", (data: unknown) => {
      void broadcastNpcUpdate(socket, data, {
        getPlayer: () => players.get(socket.id),
        admittedRevision: () => socket.data.mapRevision,
        generation: mapRefresh.generation,
        isPaused: mapRefresh.isPaused,
        requiresRefresh: () => !!socket.data.mapRefreshRequired,
        selectNpc: selectRuntimeNpc,
        readRevision: async (id) => {
          const [row] = await db
            .select({ mapData: channels.mapData })
            .from(channels)
            .where(eq(channels.id, id))
            .limit(1);
          return row ? mapContentRevision(row.mapData) : null;
        },
        invalidate: coordination.invalidate,
        invalidateRooms: (id) => invalidateRoomRuntimesForChannel(id),
      });
    });

    socket.on("npc:broadcast-remove", (data: unknown) => {
      const player = players.get(socket.id);
      if (!player) return;
      invalidateRoomRuntimesForChannel(player.mapId);
      void coordination.invalidate(player.mapId);
      socket.to(player.mapId).emit("npc:removed", data);
    });

    registerMeetingSocketHandlers({
      io,
      socket,
      deps: {
        meetingRooms,
        spatial,
        isInMeetingSpace: (channelId, socketId) =>
          coordination.spatial.isInside(channelId, socketId),
        getDiscussionState: (channelId) => activeBrokers.get(channelId)?.discussionState ?? null,
        players,
        lastChatTime,
        chatCooldownMs: CHAT_COOLDOWN_MS,
        user,
        getParticipationAccess: getSocketChannelParticipationAccess,
        emitChannelAccessDenied: (meetingSocket, input) => {
          emitChannelAccessDenied(
            meetingSocket as unknown as Socket,
            input as Parameters<typeof emitChannelAccessDenied>[1],
          );
        },
        onMeetingChat: async ({ channelId, message, room, player }) => {
          const npcConfigs = await getNpcConfigsForChannel(channelId, socketLocale(socket));
          // Stagger NPC responses with random delays, but track all promises
          const promises = npcConfigs.map((npc) => {
            const delay = 1000 + Math.random() * 2000;
            return new Promise<void>((resolve) => {
              setTimeout(async () => {
                try {
                  await streamMeetingNpcResponse(
                    io,
                    channelId,
                    npc,
                    room,
                    message,
                    player?.characterName || "Unknown",
                    user.userId,
                    userContextOf(socket),
                  );
                } catch (err) {
                  console.error(`[meeting] NPC ${npc._name} failed:`, err);
                  // Notify client that this NPC failed to respond
                  emitMeetingNpcStream(io, channelId, {
                    messageId: `error-${Date.now()}-${npc._name}`,
                    sender: npc._name,
                    chunk: "",
                    done: true,
                    error: true,
                  });
                }
                resolve();
              }, delay);
            });
          });
          await Promise.allSettled(promises);
        },
      },
    });

    registerNpcRosterHandlers({
      io,
      socket,
      deps: {
        activeBrokers,
        user,
        isChannelOwner,
        selectNpcById: selectRuntimeNpc,
        setNpcActive: async (npcId, active) => {
          await setNpcActive(npcId, active);
          const npc = await selectNpcById(npcId);
          if (npc) await coordination.invalidate(npc.channelId);
        },
      },
    });

    // 방 채팅. 등록 문자열(`socket.on("room:*")`)은 room-socket.ts 안에 있고,
    // socket-event-parity.test.ts 가 세 파일의 합집합을 본다 — 여기에 이름만 다시
    // 늘어놓으면 등록 지점이 둘이 되어 한쪽만 고치는 드리프트가 생긴다.
    registerRoomHandlers({
      io,
      socket,
      deps: {
        user,
        players,
        lastChatTime,
        cooldownMs: CHAT_COOLDOWN_MS,
        getParticipationAccess: getSocketChannelParticipationAccess,
        rooms: chatRooms,
        // 방 런타임은 방마다 캐시된다 — 규약 언어는 런타임을 처음 만든 사람의 것이다.
        getRuntime: (io, room, userId) =>
          getOrCreateRoomRuntime(io, room, userId, { locale: socketLocale(socket) }),
        invalidateRuntime: invalidateRoomRuntime,
      },
    });

    registerMeetingDiscussionHandlers({
      io,
      socket,
      deps: {
        activeBrokers,
        discussionInitiators,
        meetingRooms,
        players,
        user,
        adapterRegistry,
        // 회의를 연 사람의 화면 언어로 규약을 싣는다.
        getNpcConfigsForChannel: (channelId: string) =>
          getNpcConfigsForChannel(channelId, socketLocale(socket)),
        canControlMeeting: async (channelId, userId) => {
          const access = await getSocketChannelParticipationAccess(channelId, userId);
          return (
            !!access?.access.allowed &&
            (spatial.snapshot(channelId)?.phase !== "idle" && spatial.snapshot(channelId)
              ? spatial.owner(channelId) === userId || (await isChannelOwner(channelId, userId))
              : await canControlMeeting(channelId, userId))
          );
        },
        spatial,
        announceOutcome: announceMeetingOutcome,
        canStartMeeting: async (channelId, userId) => {
          const access = await getSocketChannelParticipationAccess(channelId, userId);
          return (
            !!access?.access.allowed &&
            !!meetingRooms.get(channelId)?.participants.has(socket.id) &&
            players.get(socket.id)?.mapId === channelId
          );
        },
        generateMeetingSummary,
        persistMeetingMinutes,
      },
    });

    // ----- disconnect -----
    socket.on("disconnect", () => {
      const player = players.get(socket.id);
      if (player) {
        playerResumeStates.save(player);
        socket.to(player.mapId).emit("player:left", { id: socket.id });

        // Save last position to DB
        const px = Math.round(player.x);
        const py = Math.round(player.y);
        void (async () => {
          await db
            .update(channelMembers)
            .set({ lastX: px, lastY: py })
            .where(
              and(
                eq(channelMembers.channelId, player.mapId),
                eq(channelMembers.userId, player.userId),
              ),
            );
        })().catch((error: unknown) => {
          console.error(
            "[socket] Position save failed:",
            error instanceof Error ? error.message : "unknown",
          );
        });

        players.delete(socket.id);
        notifyChannelActivity(io, player.mapId);
      }

      // Clean up meeting room participation
      for (const [channelId, room] of meetingRooms.entries()) {
        if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          void spatial.leavePlayer(channelId, user.userId, socket.id);
          socket.to(`meeting-${channelId}`).emit("meeting:participant-left", { id: socket.id });
        }
      }

      for (const channelId of [...activeBrokers.keys()]) {
        const room = meetingRooms.get(channelId);
        if (room && room.participants.size === 0) {
          settleMeeting({ activeBrokers, discussionInitiators, spatial }, channelId, {
            stopBroker: true,
            context: "주재자 이탈",
          });
        }
      }

      lastChatTime.delete(socket.id);
    });
  });
  return { refreshChannelMap };
}
