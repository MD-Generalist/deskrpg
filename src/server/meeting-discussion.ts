import type { MeetingDiscussionState } from "../lib/meeting-discussion-state";
import { describeMeetingFailure } from "../lib/meeting-error";
import type { MeetingSpatialCoordinator } from "./meeting-spatial-coordinator";
import { MEETING_NPC_STREAM_EVENT } from "./meeting-socket";
import type { AdapterRegistry, NpcAdapter } from "../lib/adapters/types";
import {
  ConversationEngine,
  type EngineParticipant,
  type RunMode,
} from "../lib/conversation/conversation-engine";
import type { Turn } from "../lib/conversation/transcript";
import type {
  MeetingOutcome,
  MeetingSummaryStatus,
  OutcomeParticipant,
} from "../lib/meeting-outcome";
import {
  classifyNpcDispatch,
  createHermesAdapterForNpc,
  deriveHermesContextKey,
} from "./hermes-dispatch";

const { generateTranscript } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../lib/meeting-formatter.js") as typeof import("../lib/meeting-formatter.js");

// 회의는 소켓 이벤트로만 흐르고 HTTP 로그를 남기지 않는다. 그래서 "화면에는 시작됐다고
// 뜨는데 아무도 발언하지 않는" 상태가 되면 서버 쪽에 단서가 하나도 없다 — 실제로 그
// 상태를 진단하는 데 e2e 를 두 번 5분씩 돌려야 했다. DEBUG_CHAT 과 같은 스위치를 쓴다.
const DEBUG_MEETING = process.env.DEBUG_CHAT === "1" || process.env.DEBUG_MEETING === "1";
function meetingLog(...args: unknown[]) {
  if (DEBUG_MEETING) console.log("[meeting]", ...args);
}

type MeetingRoom = {
  participants: Set<string>;
  messages: MeetingMessage[];
};

type MeetingMessage = {
  id: string;
  sender: string;
  senderId: string;
  senderType: "user" | "npc";
  content: string;
  timestamp: number;
};

type MeetingPlayer = {
  characterName?: string | null;
};

type MeetingNpcConfig = {
  id: string;
  name: string;
  agentId: string | null;
  sessionKeyPrefix: string;
  /** 백엔드 갈래 판정에 쓴다(classifyNpcDispatch). 실 소켓 배선은 항상 채워 보내지만,
   * 이 파일의 단위 테스트가 최소 픽스처를 쓰므로 optional로 두고 기본값으로 방어한다. */
  adapterType?: string;
  hermesProfileId?: string | null;
  role?: string | null;
  passPolicy?: string | null;
  /** 이 NPC 의 턴에 실을 시스템 지시. getNpcConfig* 가 계산해 넣는다. */
  instructions?: string | null;
};

type MeetingSocket = {
  id: string;
  on(event: string, handler: (payload: unknown) => unknown): void;
  emit(event: string, payload: unknown): void;
};

type MeetingIo = {
  to(room: string): {
    emit(event: string, payload: unknown): void;
  };
};

type MeetingUser = {
  userId: string;
  nickname?: string | null;
};

/** run() 시작 시 참가자별로 한 번 해석해 회의 동안 재사용하는 결과 — 어댑터 인스턴스는
 * 여기 담기지 않는다(콜백/조회용 뷰). 어댑터 자체는 회의 하나에 묶인 EngineParticipant로만 존재한다. */
type MeetingBrokerParticipant = {
  npcId: string;
  displayName: string;
  role: string;
  passPolicy: string | null;
  /** composeNpcInstructions() 결과. 폴과 발언 양쪽에 실린다. */
  instructions?: string | null;
};

type ExcludedMeetingNpc = {
  npcId: string;
  displayName: string;
  reason: "unbound" | "hermes_profile_unavailable" | "adapter_unavailable";
};

type MeetingBrokerConfig = {
  topic: string;
  npcs: MeetingNpcConfig[];
  userId: string;
  channelId: string;
  adapterRegistry: AdapterRegistry;
  sessionKeyPrefix: string;
  meetingId: string;
  settings: Record<string, unknown>;
  quota: {
    maxTotalTurns: number;
  };
};

/** `outcome`·`status` 는 선택이다 — 없으면 구조화 결과 없이 성공한 요약으로 다룬다. */
type MeetingSummary = {
  keyTopics: string[];
  conclusions: string | null;
  outcome?: MeetingOutcome | null;
  status?: MeetingSummaryStatus;
};

export type MeetingBrokerLike = {
  discussionState?: MeetingDiscussionState;
  config: {
    participants: MeetingBrokerParticipant[];
    sessionKeyPrefix?: string;
    meetingId?: string;
  };
  turns: unknown[];
  isRunning(): boolean;
  run(): Promise<void>;
  stop(): void;
  setMode(mode: string): void;
  nextTurn(): void;
  directSpeak(npcId: string): void;
  abortCurrentTurn(): void;
  addUserMessage(userName: string, content: string): void;
};

type MeetingBrokerCallbacks = {
  onPollStart?: () => void;
  onPollResult?: (
    raises: Array<{ agent: MeetingBrokerParticipant; reason: string }>,
    passes: string[],
    /** 폴에 닿지 못한 참가자. 침묵(passes)과 갈라 전달한다. */
    failures: Array<{ agent: MeetingBrokerParticipant; reason: string }>,
  ) => void;
  onTurnStart?: (agent: MeetingBrokerParticipant) => void;
  onTurnChunk?: (npcId: string, chunk: string) => void;
  onTurnEnd?: (npcId: string, fullResponse: string) => void;
  onModeChanged?: (mode: string, by: string) => void;
  onWaitingInput?: (pollResult: unknown) => void;
  onTurnAborted?: (npcId: string) => void;
  onMeetingEnd?: (transcript: string, durationSeconds?: number) => void | Promise<void>;
  /** 지목받았으나 건너뛴 NPC. onParticipantsExcluded 와 같은 계열. reason 은 할당량 소진
   * ("quota_exhausted")과 게이트웨이 연속 실패("backend_failing")를 구분한다 — 합치면
   * 죽은 게이트웨이가 정상 할당량 소진으로 보인다. */
  onMentionSkipped?: (npcId: string, reason: "quota_exhausted" | "backend_failing") => void;
  onError?: (error: unknown) => void;
  /** 어댑터를 해석하지 못해 참가자 목록에서 제외된 NPC. 조용히 빼지 않고 알린다(요구사항). */
  onParticipantsExcluded?: (excluded: ExcludedMeetingNpc[]) => void;
};

type PersistMeetingMinutesInput = {
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
};

type RegisterMeetingDiscussionHandlersArgs = {
  io: MeetingIo;
  socket: MeetingSocket;
  deps: {
    activeBrokers: Map<string, MeetingBrokerLike>;
    discussionInitiators: Map<string, string>;
    meetingRooms: Map<string, MeetingRoom>;
    players: Map<string, MeetingPlayer>;
    user: MeetingUser;
    adapterRegistry: AdapterRegistry;
    getNpcConfigsForChannel: (channelId: string) => Promise<MeetingNpcConfig[]>;
    canControlMeeting: (channelId: string, userId: string) => Promise<boolean> | boolean;
    spatial?: MeetingSpatialCoordinator;
    /**
     * 후속 업무가 나온 회의가 끝나면 사무실 방에 알린다. 선택 의존이다 — 주입하지 않으면 알림이 없다
     * (소켓·DB 없이 도는 회의 테스트가 그대로 돈다). 구현은 던지지 않는다.
     */
    announceOutcome?: (input: {
      channelId: string;
      minutesId: string | null;
      topic: string;
      outcome: MeetingOutcome | null;
      summaryStatus: MeetingSummaryStatus;
    }) => Promise<void>;
    canStartMeeting?: (channelId: string, userId: string) => Promise<boolean> | boolean;
    createMeetingBroker?: (
      config: MeetingBrokerConfig,
      callbacks: MeetingBrokerCallbacks,
    ) => MeetingBrokerLike | Promise<MeetingBrokerLike>;
    /** 회의 요약. 예전에는 OpenClaw 게이트웨이의 chatSend 에 직접 매여 있어서
     * `gateway && openclawAgentId` 인 회의에서만 돌았다 — 즉 Hermes 회의는 늘 빈 요약을
     * 남겼다. 이제 참가자 어댑터를 그대로 받아 백엔드와 무관하게 돈다. */
    generateMeetingSummary: (
      adapter: NpcAdapter,
      sessionKey: string,
      topic: string,
      transcript: string,
      /** 후속 업무의 담당 후보 — 회의에 참석한 직원만. */
      participants?: OutcomeParticipant[],
    ) => Promise<MeetingSummary>;
    persistMeetingMinutes: (input: PersistMeetingMinutesInput) => Promise<string | null>;
  };
};

/** setMode와 같은 기준으로 검증한다(conversation-engine.ts:setMode). 알 수 없는 값은 "auto". */
function toRunMode(value: unknown): RunMode {
  return value === "auto" || value === "manual" || value === "directed" ? value : "auto";
}

function getMeetingRoomId(channelId: string) {
  return `meeting-${channelId}`;
}

/** createHermesAdapterForNpc와 같은 모양 — 프로필을 못 찾으면 null. */
type CreateHermesAdapter = (
  npcId: string,
  userId: string,
  contextKey: string,
) => Promise<NpcAdapter | null>;

export type ResolvedMeetingParticipant = {
  participant: MeetingBrokerParticipant;
  adapter: NpcAdapter;
  sessionKey: string;
};

/**
 * NPC 한 명을 실제 백엔드 어댑터로 해석한다. P1b 판정(HermesAdapter는 회의 하나당 한 번만 만들고
 * 그 회의 동안 재사용 — 여러 회의가 공유하는 싱글턴으로 등록하지 않는다)을 지키기 위해, 이 함수는
 * 회의 시작 시점에 참가자별로 정확히 한 번만 호출된다.
 */
/**
 * 회의 세션 범위. Hermes 세션은 `<prefix>-<scope>` 로 키가 잡히므로 이 문자열이
 * 바뀌면 그 NPC 의 대화 맥락이 끊긴다. 리터럴을 호출부에 흩어 두지 않는 이유는
 * 실제로 한 번 어긋난 적이 있기 때문이다 — 요약 범위에서 `-meeting-` 이 빠졌다.
 */
export function meetingSessionScope(meetingId: string): string {
  return `meeting-${meetingId}`;
}

/**
 * 요약자 세션 범위. 회의 범위와 **반드시 달라야** 한다 — 같으면 요약 프롬프트가
 * 그 NPC 의 회의 맥락에 섞여 다음 회의 발언이 오염된다.
 */
export function meetingSummarySessionScope(meetingId: string): string {
  return `${meetingSessionScope(meetingId)}-summary`;
}

export async function resolveNpcAdapter(
  npc: MeetingNpcConfig,
  ctx: {
    sessionScope: string;
    userId: string;
    adapterRegistry: AdapterRegistry;
    /** 테스트에서 DB·게이트웨이 없이 hermes 갈래를 관찰하기 위한 주입점. 기본값이 실제 배선이다. */
    createHermesAdapter?: CreateHermesAdapter;
  },
): Promise<ResolvedMeetingParticipant | { excluded: ExcludedMeetingNpc }> {
  const adapterType = npc.adapterType || "hermes";
  const hermesProfileId = npc.hermesProfileId ?? null;
  const dispatchKind = classifyNpcDispatch({ adapterType, hermesProfileId });
  const sessionKeyBase = npc.sessionKeyPrefix || npc.id;
  const sessionKey = `${sessionKeyBase}-${ctx.sessionScope}`;

  const participantBase: MeetingBrokerParticipant = {
    npcId: npc.id,
    displayName: npc.name,
    role: npc.role || "Participant",
    passPolicy: npc.passPolicy || null,
    instructions: npc.instructions ?? null,
  };

  if (dispatchKind === "unbound") {
    return { excluded: { npcId: npc.id, displayName: npc.name, reason: "unbound" } };
  }

  if (dispatchKind === "hermes") {
    const contextKey = deriveHermesContextKey(sessionKey, sessionKeyBase);
    const createAdapter = ctx.createHermesAdapter ?? createHermesAdapterForNpc;
    const adapter = await createAdapter(npc.id, ctx.userId, contextKey);
    if (!adapter) {
      return {
        excluded: { npcId: npc.id, displayName: npc.name, reason: "hermes_profile_unavailable" },
      };
    }
    return { participant: participantBase, adapter, sessionKey };
  }

  if (dispatchKind === "openclaw") {
    // OpenClaw 는 제거됐다. 남아 있는 openclaw NPC 는 회의에서 조용히 빠지는 대신
    // 이유를 달고 제외되어, 사용자가 다시 연결해야 한다는 것을 알 수 있게 한다.
    return { excluded: { npcId: npc.id, displayName: npc.name, reason: "unbound" } };
  }

  // dispatchKind === "registry"
  if (!ctx.adapterRegistry.has(adapterType)) {
    return { excluded: { npcId: npc.id, displayName: npc.name, reason: "adapter_unavailable" } };
  }
  return {
    participant: participantBase,
    adapter: ctx.adapterRegistry.get(adapterType),
    sessionKey,
  };
}

export async function defaultCreateMeetingBroker(
  config: MeetingBrokerConfig,
  callbacks: MeetingBrokerCallbacks,
  deps: { createHermesAdapter?: CreateHermesAdapter } = {},
): Promise<MeetingBrokerLike> {
  const resolved: ResolvedMeetingParticipant[] = [];
  const excluded: ExcludedMeetingNpc[] = [];

  for (const npc of config.npcs) {
    const result = await resolveNpcAdapter(npc, {
      sessionScope: meetingSessionScope(config.meetingId),
      userId: config.userId,
      adapterRegistry: config.adapterRegistry,
      createHermesAdapter: deps.createHermesAdapter,
    });
    if ("excluded" in result) {
      excluded.push(result.excluded);
    } else {
      resolved.push(result);
    }
  }

  if (excluded.length > 0) {
    callbacks.onParticipantsExcluded?.(excluded);
  }

  const participantByNpcId = new Map(resolved.map((r) => [r.participant.npcId, r.participant]));

  const engineParticipants: EngineParticipant[] = resolved.map(
    ({ participant, adapter, sessionKey }) => ({
      npcId: participant.npcId,
      displayName: participant.displayName,
      seated: true,
      turnCount: 0,
      lastSpokeAt: 0,
      adapter,
      sessionKey,
      role: participant.role,
      passPolicy: participant.passPolicy,
      instructions: participant.instructions ?? null,
    }),
  );

  let turns: Turn[] = [];
  const startedAt = Date.now();

  const engine = new ConversationEngine(
    {
      mode: "meeting",
      topic: config.topic,
      participants: engineParticipants,
      quota: {
        maxTurnsPerAgent: 20,
        maxTotalTurns: config.quota.maxTotalTurns,
        maxConsecutivePasses: 2,
        cooldownMs: 1000,
      },
      // 캐스팅이 아니라 검증한다 — 엔진 생성자는 setMode와 달리 값을 검사하지 않아서,
      // 잘못된 값은 auto처럼 동작하면서 meeting:mode-changed로 그 잘못된 문자열을
      // 클라이언트에 되돌려주는 상태로 남는다.
      initialRunMode: toRunMode(config.settings?.initialMode),
      hybridMode: Boolean(config.settings?.hybridMode),
      hybridAutoResumeMs: (config.settings?.hybridAutoResumeMs as number) ?? null,
    },
    {
      onPollStart: () => callbacks.onPollStart?.(),
      onPollResult: (raises, passes, failures) => {
        meetingLog(
          "폴링 결과: raises=",
          raises.map((r) => r.npcId).join(",") || "(없음)",
          "passes=",
          passes.join(",") || "(없음)",
          "failures=",
          (failures ?? []).map((f) => f.npcId).join(",") || "(없음)",
        );
        callbacks.onPollResult?.(
          raises
            .map((r) => {
              const agent = participantByNpcId.get(r.npcId);
              return agent ? { agent, reason: r.reason } : null;
            })
            .filter((r): r is { agent: MeetingBrokerParticipant; reason: string } => r !== null),
          passes,
          (failures ?? [])
            .map((f) => {
              const agent = participantByNpcId.get(f.npcId);
              return agent ? { agent, reason: f.reason } : null;
            })
            .filter((f): f is { agent: MeetingBrokerParticipant; reason: string } => f !== null),
        );
      },
      onTurnStart: (npcId) => {
        meetingLog("턴 시작:", npcId);
        const agent = participantByNpcId.get(npcId);
        if (agent) callbacks.onTurnStart?.(agent);
      },
      onTurnChunk: (npcId, chunk) => callbacks.onTurnChunk?.(npcId, chunk),
      onTurnEnd: (npcId, fullResponse) => callbacks.onTurnEnd?.(npcId, fullResponse),
      onModeChanged: (mode, source) => callbacks.onModeChanged?.(mode, source),
      onWaitingInput: (pollResult) => callbacks.onWaitingInput?.(pollResult),
      onMentionSkipped: (npcId, reason) => callbacks.onMentionSkipped?.(npcId, reason),
      onError: (err) => callbacks.onError?.(err),
      onEnd: (finalTurns) => {
        turns = finalTurns;
        const transcript = generateTranscript(
          config.topic,
          finalTurns,
          resolved.map(({ participant }) => ({
            displayName: participant.displayName,
            role: participant.role,
          })),
        );
        const durationSeconds = Math.floor((Date.now() - startedAt) / 1000);
        void callbacks.onMeetingEnd?.(transcript, durationSeconds);
      },
    },
  );

  return {
    config: {
      participants: resolved.map((r) => r.participant),
      sessionKeyPrefix: config.sessionKeyPrefix,
      meetingId: config.meetingId,
    },
    get turns() {
      return turns;
    },
    isRunning: () => engine.isRunning(),
    run: () => engine.run(),
    stop: () => engine.stop(),
    setMode: (mode) => engine.setMode(mode),
    nextTurn: () => engine.nextTurn(),
    directSpeak: (npcId) => engine.directSpeak(npcId),
    abortCurrentTurn: () => engine.abortCurrentTurn(),
    addUserMessage: (userName, content) => engine.addUserMessage(userName, content),
  };
}

/**
 * 회의를 끝내는 경로가 모두 부르는 정산 — 브로커 정리와 직원 복귀를 한 곳에서 한다.
 * 예전에는 경로마다 따로 적었고, 주재자가 떠나 방이 비는 경로(socket-handlers 의 disconnect)만
 * 복귀를 빠뜨려 직원이 회의석에 남았다. 게다가 그 공간 세션이 "ready" 에 머물러
 * spatial.start 가 null 을 돌려주므로, 그 채널의 다음 회의는 조용히 시작되지 않았다.
 */
export function settleMeeting(
  state: {
    activeBrokers: Map<string, MeetingBrokerLike>;
    discussionInitiators: Map<string, string>;
    spatial?: Pick<MeetingSpatialCoordinator, "cancel">;
  },
  channelId: string,
  opts: { stopBroker?: boolean; context: string },
): void {
  if (opts.stopBroker) state.activeBrokers.get(channelId)?.stop();
  state.activeBrokers.delete(channelId);
  state.discussionInitiators.delete(channelId);
  void state.spatial?.cancel(channelId).catch((error) => {
    console.error(`[meeting] ${opts.context} 후 복귀 정산 실패`, { channelId }, error);
  });
}

export function registerMeetingDiscussionHandlers({
  io,
  socket,
  deps,
}: RegisterMeetingDiscussionHandlersArgs) {
  const {
    activeBrokers,
    discussionInitiators,
    meetingRooms,
    players,
    user,
    adapterRegistry,
    getNpcConfigsForChannel,
    canControlMeeting,
    createMeetingBroker = defaultCreateMeetingBroker,
    generateMeetingSummary,
    persistMeetingMinutes,
  } = deps;

  socket.on("meeting:start-discussion", async (payload: unknown) => {
    const { channelId, topic, settings, selectedNpcIds } = (payload ?? {}) as {
      channelId?: string;
      topic?: string;
      settings?: Record<string, unknown> & { maxTotalTurns?: number; initialMode?: string };
      selectedNpcIds?: string[];
    };

    meetingLog("start-discussion 수신:", { channelId, topic: topic?.slice(0, 40), selectedNpcIds });
    if (typeof channelId !== "string" || typeof topic !== "string" || !topic.trim()) return;
    if (
      selectedNpcIds !== undefined &&
      (!Array.isArray(selectedNpcIds) || selectedNpcIds.some((id) => typeof id !== "string"))
    ) {
      socket.emit("meeting:error", { error: "invalid_participants" });
      return;
    }
    if (deps.canStartMeeting && !(await deps.canStartMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }
    if (activeBrokers.has(channelId)) {
      socket.emit("meeting:error", { error: "A meeting is already in progress" });
      return;
    }

    // 예전에는 여기서 getOrConnectGateway(channelId) 를 조건 없이 await 했다. 주석은
    // "openclaw 참가자를 해석할 때만 필요하다"고 적혀 있었지만 코드는 늘 불렀고, Hermes
    // 게이트웨이가 OpenClaw WS 핸드셰이크에 403 을 돌려주면 그 자리에서 매달렸다 —
    // 화면에는 "토론이 시작되었습니다"만 뜬 채 첫 턴이 영영 디스패치되지 않았다.
    // OpenClaw 가 사라진 지금은 획득할 게이트웨이 자체가 없다.

    const npcConfigs = await getNpcConfigsForChannel(channelId);
    let candidateNpcs = npcConfigs;

    if (selectedNpcIds && selectedNpcIds.length > 0) {
      const selectedSet = new Set(selectedNpcIds);
      candidateNpcs = candidateNpcs.filter((npc) => selectedSet.has(npc.id));
    }
    let spatialGeneration: number | null = null;
    if (deps.spatial) {
      spatialGeneration = await deps.spatial.start(
        channelId,
        user.userId,
        selectedNpcIds?.length ? selectedNpcIds : candidateNpcs.map((n) => n.id),
      );
      if (spatialGeneration === null) return;
      discussionInitiators.set(channelId, user.userId);
      const missing = selectedNpcIds?.find((id) => !npcConfigs.some((n) => n.id === id));
      if (missing) deps.spatial.block(channelId, missing, "actor_unavailable", spatialGeneration);
      if (!(await deps.spatial.ready(channelId, spatialGeneration))) return;
      if (deps.canStartMeeting && !(await deps.canStartMeeting(channelId, user.userId))) {
        deps.spatial.block(channelId, user.userId, "participant_left", spatialGeneration);
        return;
      }
    }

    meetingLog(
      "후보 NPC:",
      candidateNpcs.map((n) => `${n.name}(${n.adapterType})`).join(", ") || "(없음)",
    );
    if (candidateNpcs.length === 0) {
      socket.emit("meeting:error", { error: "No AI NPCs in this channel" });
      return;
    }

    const meetingParticipants: Array<{
      id: string;
      name: string;
      type: "npc" | "player";
      agentId?: string;
    }> = [
      ...candidateNpcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        type: "npc" as const,
        agentId: npc.agentId || undefined,
      })),
    ];

    const room = meetingRooms.get(channelId);
    if (room) {
      for (const participantId of room.participants) {
        const player = players.get(participantId);
        if (!player) continue;
        meetingParticipants.push({
          id: participantId,
          name: player.characterName || "Unknown",
          type: "player",
        });
      }
    }

    const meetingId = `meet-${Date.now()}`;
    const sessionKeyPrefix = candidateNpcs[0].sessionKeyPrefix || channelId.slice(0, 8);

    // 요약용 어댑터는 회의 참가자와 **별도로** 한 번 해석한다. 브로커의 config.participants
    // 는 어댑터를 담지 않는 조회용 뷰이므로(위 타입 주석 참조) 밖에서는 닿을 수 없고,
    // 요약 세션은 어차피 회의 세션과 분리되어야 한다 — 요약 프롬프트가 그 NPC 의 회의
    // 맥락에 섞이면 다음 회의 발언이 오염된다.
    const summarizerResolution = await resolveNpcAdapter(candidateNpcs[0], {
      sessionScope: meetingSummarySessionScope(meetingId),
      userId: user.userId,
      adapterRegistry,
    });
    const summarizerAdapter =
      "adapter" in summarizerResolution ? summarizerResolution.adapter : null;

    const brokerInstance = await createMeetingBroker(
      {
        topic,
        npcs: candidateNpcs,
        userId: user.userId,
        channelId,
        adapterRegistry,
        sessionKeyPrefix,
        meetingId,
        settings: settings || {},
        quota: {
          maxTotalTurns: settings?.maxTotalTurns || 50,
        },
      },
      {
        onPollStart: () => {
          if (brokerInstance.discussionState) brokerInstance.discussionState.isWaitingInput = false;
          io.to(getMeetingRoomId(channelId)).emit("meeting:poll-status", { status: "polling" });
        },
        onPollResult: (raises, passes, failures) => {
          io.to(getMeetingRoomId(channelId)).emit("meeting:poll-status", {
            raises: raises.map((raise) => ({
              name: raise.agent.displayName,
              reason: raise.reason,
            })),
            passes,
            // 닿지 못한 참가자를 침묵과 구분해 보낸다 — 화면이 "전원 PASS" 로
            // 뭉개지 않게.
            failures: (failures ?? []).map((failure) => ({
              name: failure.agent.displayName,
              reason: failure.reason,
            })),
          });
        },
        onTurnStart: (agent) => {
          const state = brokerInstance.discussionState;
          if (state) {
            state.isWaitingInput = false;
            state.currentSpeaker = { npcId: agent.npcId, npcName: agent.displayName };
            state.rawStreams = {};
          }
          io.to(getMeetingRoomId(channelId)).emit("meeting:npc-turn-start", {
            npcId: agent.npcId,
            npcName: agent.displayName,
          });
        },
        onTurnChunk: (npcId, chunk) => {
          const state = brokerInstance.discussionState;
          if (state) {
            state.rawStreams ??= {};
            state.rawStreams[npcId] = (state.rawStreams[npcId] || "") + chunk;
          }
          io.to(getMeetingRoomId(channelId)).emit(MEETING_NPC_STREAM_EVENT, {
            npcId,
            chunk,
            done: false,
          });
        },
        onTurnEnd: (npcId, fullResponse) => {
          const state = brokerInstance.discussionState;
          if (state) {
            state.currentSpeaker = null;
            delete state.rawStreams?.[npcId];
          }
          const agent = brokerInstance.config.participants.find(
            (participant) => participant.npcId === npcId,
          );
          io.to(getMeetingRoomId(channelId)).emit(MEETING_NPC_STREAM_EVENT, {
            npcId,
            npcName: agent?.displayName || npcId,
            chunk: "",
            done: true,
            // 화면은 말풍선을 이것으로 확정한다. 델타 누적분은 재시도된 앞선 생성까지 담을 수 있어,
            // 그대로 확정하면 아래에서 회의 기록에 남기는 본문과 어긋난다.
            text: fullResponse,
          });

          const liveRoom = meetingRooms.get(channelId);
          if (!liveRoom) return;
          // 중단된 턴은 부분 텍스트조차 없을 수 있다 — 말풍선은 위에서 닫아주되 빈 메시지를
          // 회의 기록에 남기지는 않는다.
          if (!fullResponse) return;

          liveRoom.messages.push({
            id: `msg-${Date.now()}-${npcId}`,
            sender: agent?.displayName || npcId,
            senderId: `npc-${npcId}`,
            senderType: "npc",
            content: fullResponse,
            timestamp: Date.now(),
          });
          if (liveRoom.messages.length > 100) {
            liveRoom.messages.splice(0, liveRoom.messages.length - 100);
          }
        },
        onModeChanged: (mode, by) => {
          if (
            brokerInstance.discussionState &&
            (mode === "auto" || mode === "manual" || mode === "directed")
          )
            brokerInstance.discussionState.mode = mode;
          const state = brokerInstance.discussionState;
          // A mode change releases the engine wait; the next waiting callback re-arms it.
          if (state) state.isWaitingInput = false;
          io.to(getMeetingRoomId(channelId)).emit("meeting:mode-changed", {
            mode,
            by,
            execution: state
              ? {
                  isWaitingInput: state.isWaitingInput,
                  currentSpeaker: state.currentSpeaker,
                  rawStreams: { ...state.rawStreams },
                }
              : undefined,
          });
        },
        onWaitingInput: (pollResult) => {
          if (brokerInstance.discussionState) brokerInstance.discussionState.isWaitingInput = true;
          io.to(getMeetingRoomId(channelId)).emit("meeting:waiting-input", { pollResult });
        },
        onTurnAborted: (npcId) => {
          const state = brokerInstance.discussionState;
          if (state) {
            state.currentSpeaker = null;
            delete state.rawStreams?.[npcId];
          }
          io.to(getMeetingRoomId(channelId)).emit("meeting:turn-aborted", { npcId });
        },
        onParticipantsExcluded: (excluded) => {
          meetingLog("제외:", excluded.map((e) => `${e.displayName}=${e.reason}`).join(", "));
          const names = excluded.map((e) => e.displayName).join(", ");
          io.to(getMeetingRoomId(channelId)).emit("meeting:error", {
            error: `Excluded from the meeting (no usable backend): ${names}`,
          });
        },
        onMentionSkipped: (npcId, reason) => {
          const agent = brokerInstance.config.participants.find(
            (participant) => participant.npcId === npcId,
          );
          meetingLog("지목 건너뜀:", `${agent?.displayName || npcId}=${reason}`);
          // 표시 문구는 여기서 만들지 않는다 — npcId/reason 만 넘기고 클라이언트가
          // i18n(meeting.mentionSkipped.*)으로 렌더한다.
          io.to(getMeetingRoomId(channelId)).emit("meeting:mention-skipped", {
            npcId,
            npcName: agent?.displayName || npcId,
            reason,
          });
        },
        onMeetingEnd: async (transcript, durationSeconds) => {
          if (activeBrokers.get(channelId) !== brokerInstance) return;
          // 요약할 직원이 없으면 실패가 아니라 건너뛴 것이다 — 다시 시도해도 같은 결과다.
          let summary: MeetingSummary = {
            keyTopics: [],
            conclusions: null,
            outcome: null,
            status: "skipped",
          };
          // 참가자 중 아무나 한 명에게 요약을 시킨다. 요약 세션 키는 회의 세션과 분리해
          // 요약 프롬프트가 그 NPC 의 회의 맥락에 섞이지 않게 한다.
          if (summarizerAdapter) {
            const summaryKey = `${brokerInstance.config.sessionKeyPrefix || sessionKeyPrefix}-summary-${
              brokerInstance.config.meetingId || meetingId
            }`;
            summary = await generateMeetingSummary(
              summarizerAdapter,
              summaryKey,
              topic,
              transcript,
              meetingParticipants
                .filter((participant) => participant.type === "npc")
                .map((participant) => ({ npcId: participant.id, name: participant.name })),
            );
          }

          if (activeBrokers.get(channelId) !== brokerInstance) return;
          const minutesId = await persistMeetingMinutes({
            channelId,
            topic,
            transcript,
            participants: meetingParticipants,
            totalTurns: brokerInstance.turns.length,
            durationSeconds,
            initiatorId: discussionInitiators.get(channelId) || null,
            keyTopics: summary.keyTopics,
            conclusions: summary.conclusions,
            outcome: summary.outcome ?? null,
            summaryStatus: summary.status ?? "ok",
          });

          if (activeBrokers.get(channelId) !== brokerInstance) return;
          io.to(getMeetingRoomId(channelId)).emit("meeting:end", {
            transcript,
            keyTopics: summary.keyTopics,
            conclusions: summary.conclusions,
            outcome: summary.outcome ?? null,
            summaryStatus: summary.status ?? "ok",
            minutesId,
            discussion: brokerInstance.discussionState,
            participantCount: meetingParticipants.length,
            totalTurns: brokerInstance.turns.length,
            durationSeconds,
          });

          // 회의실 밖 사람도 알 수 있게 사무실 방에 남긴다. 조건(후속 업무 있음·요약 성공)은 구현이 본다.
          void deps.announceOutcome?.({
            channelId,
            minutesId,
            topic,
            outcome: summary.outcome ?? null,
            summaryStatus: summary.status ?? "ok",
          });

          settleMeeting(deps, channelId, { context: "회의 종료" });
        },
        onError: (error) => {
          // 어댑터가 던진 값(HermesError 등)을 그대로 실으면 화면이 [object Object] 를 그린다.
          const failure = describeMeetingFailure(error);
          console.warn("[meeting] NPC 응답 실패", { channelId, code: failure.error }, error);
          io.to(getMeetingRoomId(channelId)).emit("meeting:error", failure);
        },
      },
    );

    // 어댑터 해석 결과 참가 가능한 NPC가 하나도 남지 않으면(전부 unbound/미해석) 조용히 빈 회의를
    // 시작-즉시종료하지 않고, 시작 전 검사와 동일하게 실패로 끝낸다. 제외 사유는
    // onParticipantsExcluded가 이미 개별 통지했다 — 이건 "그래서 회의 자체가 시작되지 않았다"는
    // 별도의 최종 신호다.
    if (brokerInstance.config.participants.length === 0) {
      if (deps.spatial && spatialGeneration !== null)
        deps.spatial.block(
          channelId,
          candidateNpcs[0]?.id ?? user.userId,
          "backend_unavailable",
          spatialGeneration,
        );
      socket.emit("meeting:error", { error: "No AI NPCs in this channel" });
      return;
    }
    if (deps.spatial && spatialGeneration !== null) {
      const excluded = candidateNpcs.find(
        (n) => !brokerInstance.config.participants.some((p) => p.npcId === n.id),
      );
      if (excluded) {
        deps.spatial.block(channelId, excluded.id, "backend_unavailable", spatialGeneration);
        return;
      }
      if (
        deps.spatial.snapshot(channelId)?.generation !== spatialGeneration ||
        deps.spatial.snapshot(channelId)?.phase !== "ready"
      )
        return;
    }

    meetingLog(
      "브로커 시작:",
      brokerInstance.config.participants.map((p) => p.displayName).join(", "),
    );
    brokerInstance.discussionState = {
      topic,
      npcs: brokerInstance.config.participants.map((npc) => ({
        id: npc.npcId,
        name: npc.displayName,
      })),
      mode: settings?.initialMode === "manual" ? "manual" : "auto",
      initiatorId: user.userId,
      initiatorSocketId: socket.id,
      isWaitingInput: false,
      currentSpeaker: null,
      rawStreams: {},
    };
    if (room) room.messages = [];
    activeBrokers.set(channelId, brokerInstance);
    discussionInitiators.set(channelId, user.userId);

    brokerInstance.run().catch((error) => {
      if (activeBrokers.get(channelId) !== brokerInstance) return;
      console.error("[meeting] Broker error:", error);
      settleMeeting(deps, channelId, { context: "오류 종료" });
      io.to(getMeetingRoomId(channelId)).emit("meeting:error", {
        error: "Meeting ended due to error",
      });
    });

    io.to(getMeetingRoomId(channelId)).emit("meeting:mode-changed", {
      mode: settings?.initialMode || "auto",
      by: user.userId,
      initiatorId: user.userId,
      discussion: brokerInstance.discussionState,
    });
  });

  socket.on("meeting:user-speak", (payload: unknown) => {
    const { channelId, message } = (payload ?? {}) as { channelId?: string; message?: string };
    if (!channelId || !message) return;

    const broker = activeBrokers.get(channelId);
    if (!broker || !broker.isRunning()) return;

    const player = players.get(socket.id);
    const userName = player?.characterName || user.nickname || "Unknown";
    const trimmed = String(message).trim().slice(0, 500);
    if (!trimmed) return;

    broker.addUserMessage(userName, trimmed);

    const room = meetingRooms.get(channelId);
    const userMessage: MeetingMessage = {
      id: `msg-${Date.now()}-user`,
      sender: userName,
      senderId: socket.id,
      senderType: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    if (room) {
      room.messages.push(userMessage);
      if (room.messages.length > 100) {
        room.messages.splice(0, room.messages.length - 100);
      }
    }

    io.to(getMeetingRoomId(channelId)).emit("meeting:message", userMessage);
  });

  socket.on("meeting:stop", async (payload: unknown) => {
    const { channelId } = (payload ?? {}) as { channelId?: string };
    if (!channelId) return;
    if (!(await canControlMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }
    await deps.spatial?.cancel(channelId);

    const broker = activeBrokers.get(channelId);
    if (!broker) return;

    broker.stop();
    discussionInitiators.delete(channelId);
  });

  socket.on("meeting:cancel-preparation", async (payload: unknown) => {
    const { channelId } = (payload ?? {}) as { channelId?: string };
    if (!channelId || !(await canControlMeeting(channelId, user.userId))) return;
    if (activeBrokers.has(channelId)) return;
    await deps.spatial?.cancel(channelId);
  });

  socket.on("meeting:set-mode", async (payload: unknown) => {
    const { channelId, mode } = (payload ?? {}) as { channelId?: string; mode?: string };
    if (!channelId || !mode) return;

    if (!(await canControlMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }

    if (!["auto", "manual", "directed"].includes(mode)) {
      socket.emit("meeting:error", { error: "Invalid mode" });
      return;
    }

    const broker = activeBrokers.get(channelId);
    if (!broker || !broker.isRunning()) return;
    broker.setMode(mode);
  });

  socket.on("meeting:next-turn", async (payload: unknown) => {
    const { channelId } = (payload ?? {}) as { channelId?: string };
    if (!channelId) return;

    if (!(await canControlMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }

    const broker = activeBrokers.get(channelId);
    if (!broker || !broker.isRunning()) return;
    const state = broker.discussionState;
    if (state?.mode !== "manual" || state.isWaitingInput !== true) return;
    // Consume readiness before calling the engine so repeated requests cannot queue a release.
    state.isWaitingInput = false;
    broker.nextTurn();
  });

  socket.on("meeting:direct-speak", async (payload: unknown) => {
    const { channelId, npcId } = (payload ?? {}) as { channelId?: string; npcId?: string };
    if (!channelId || !npcId) return;

    if (!(await canControlMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }

    const broker = activeBrokers.get(channelId);
    if (!broker || !broker.isRunning()) return;

    const agent = broker.config.participants.find((participant) => participant.npcId === npcId);
    if (!agent) {
      socket.emit("meeting:error", { error: "NPC not found or has no agent" });
      return;
    }

    broker.directSpeak(npcId);
  });

  socket.on("meeting:abort-turn", async (payload: unknown) => {
    const { channelId } = (payload ?? {}) as { channelId?: string };
    if (!channelId) return;

    if (!(await canControlMeeting(channelId, user.userId))) {
      socket.emit("meeting:error", { error: "Permission denied" });
      return;
    }

    const broker = activeBrokers.get(channelId);
    if (!broker || !broker.isRunning()) return;
    broker.abortCurrentTurn();
  });
}
