/**
 * 자동화 사건 싱크 (T5, R25).
 *
 * 플러그인의 통합 이벤트(`/deskrpg/events`)가 DeskRPG 안으로 들어오는 **유일한 문**이다.
 * 폴러(`automation-poller.ts`)가 부르고, 나중에 푸시 라우트가 생겨도 같은 함수를 부른다.
 * 하드 게이트 5: 방 알림·맵 상태는 다른 어떤 경로도 직접 만들지 않는다 — 모두 여기를 거친다.
 *
 * 한 사건에 대해 하는 일은 셋뿐이다.
 *  (a) 채널 소켓 방송 — `task.*` 는 `kanban:event`, `cron.*` 는 `cron:event`
 *  (b) 맵 상태 — NPC 에게 진행 중인 카드 실행·크론 실행이 하나라도 있으면 "작업 중"(R27).
 *      `npc:working` 은 값이 **바뀔 때만** 나간다.
 *  (c) 방 알림 — 카드의 blocked 진입(모두)·최상위 카드의 done 진입(R28), 이 채널 출처의
 *      크론 결과(R30). 담당 NPC 가 잠들었거나 빠졌으면 시스템 메시지로 올리되 NPC 이름을
 *      앞에 붙인다(R22) — 놓치지 않는다.
 *
 * 같은 사건 ID 는 두 번 처리하지 않는다(채널별 최근 ID 집합, 크기 상한 tunable).
 *
 * 핵심은 DB 를 모른다 — 조회·저장·방송을 전부 `IngestDeps` 로 받는다. 그래서 단위 테스트가
 * 규칙만 고정할 수 있고, 실제 배선은 아래 `createLiveIngestDeps` 한 곳에 있다.
 */

import { eq, and } from "drizzle-orm";

import { db, hermesProfiles, npcs } from "@/db";
import type { RoomMessage, RoomNotice } from "@/lib/chat-rooms-policy";
import { appendRoomMessage, ensureOfficeRoom, getChannelOwnerId } from "@/lib/chat-rooms";
import { findCronOrigin, resolveOriginForGateway } from "@/lib/cron-origins";
import type {
  CronRunFinishedPayload,
  CronRunStartedPayload,
  PluginEvent,
  TaskStatusEventPayload,
} from "@/lib/hermes/deskrpg-plugin-types";

// ---------------------------------------------------------------------------
// 소켓 이벤트 이름 — 하드 게이트 10: 새 이벤트는 이 셋뿐이다.
// ---------------------------------------------------------------------------

export const AUTOMATION_SOCKET_EVENTS = {
  kanban: "kanban:event",
  cron: "cron:event",
  working: "npc:working",
} as const;

export type NpcWorkingPayload = {
  npcId: string;
  working: boolean;
  sources: { runningCards: number; cronRuns: number };
};

// ---------------------------------------------------------------------------
// 조정값 — 환경변수로 바꿀 수 있다.
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** 크론 결과 본문 길이 상한(R30). 초과하면 앞부분 + "…". */
export const DEFAULT_RESULT_MAX_CHARS = envInt("AUTOMATION_RESULT_MAX_CHARS", 2000);
/** 채널별로 기억하는 최근 사건 ID 수. */
export const DEFAULT_DEDUPE_LIMIT = envInt("AUTOMATION_EVENT_DEDUPE_LIMIT", 1000);

// ---------------------------------------------------------------------------
// 프로세스 상태 — 중복 집합 + NPC 별 진행 중 실행
// ---------------------------------------------------------------------------

type NpcWork = { runningCards: Set<string>; cronRuns: Set<string> };

type ChannelState = {
  /** 최근 처리한 사건 ID. Set 의 삽입 순서를 그대로 LRU 로 쓴다. */
  seen: Set<string>;
  /** npcId → 진행 중 집합 */
  work: Map<string, NpcWork>;
  /** npcId → 마지막으로 방송한 `npc:working` 의 직렬화 값. 같으면 다시 쏘지 않는다. */
  lastEmitted: Map<string, string>;
};

export type AutomationState = Map<string, ChannelState>;

export function createAutomationState(): AutomationState {
  return new Map();
}

const defaultState: AutomationState = createAutomationState();

function channelState(state: AutomationState, channelId: string): ChannelState {
  let s = state.get(channelId);
  if (!s) {
    s = { seen: new Set(), work: new Map(), lastEmitted: new Map() };
    state.set(channelId, s);
  }
  return s;
}

/** 테스트·재바인딩용 — 채널 하나(또는 전부)의 상태를 버린다. */
export function resetAutomationState(channelId?: string, state: AutomationState = defaultState) {
  if (channelId === undefined) state.clear();
  else state.delete(channelId);
}

function workingPayload(npcId: string, work: NpcWork): NpcWorkingPayload {
  const runningCards = work.runningCards.size;
  const cronRuns = work.cronRuns.size;
  return { npcId, working: runningCards + cronRuns > 0, sources: { runningCards, cronRuns } };
}

/**
 * 지금 "작업 중" 인 NPC 들의 현재 값. 채널 접속(player:join) 때 그 소켓에 한 번 보낸다(R27).
 * 끝난 NPC 는 포함하지 않는다 — 클라이언트의 기본값이 `working:false` 다.
 */
export function getWorkingSnapshot(
  channelId: string,
  state: AutomationState = defaultState,
): NpcWorkingPayload[] {
  const s = state.get(channelId);
  if (!s) return [];
  const out: NpcWorkingPayload[] = [];
  for (const [npcId, work] of s.work) {
    const payload = workingPayload(npcId, work);
    if (payload.working) out.push(payload);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 의존성
// ---------------------------------------------------------------------------

/** 프로필 이름 → 이 채널의 NPC. 프로필이 게이트웨이에 없으면 null, NPC 행이 없으면 `npc:null`. */
export type ChannelNpcLookup = {
  profileName: string;
  /** `hermes_profiles.display_name ?? profile_name` — `npcs.name` 은 읽지 않는다. */
  displayName: string;
  npc: { id: string; active: boolean } | null;
};

export type IngestDeps = {
  /** 채널의 현재 게이트웨이. 크론 출처 대조에 쓴다(R30). */
  gatewayId: string;
  /** 채널의 보드 slug. 카드 알림의 `notice.boardSlug`. */
  boardSlug: string;
  findNpcByProfile(channelId: string, profileName: string): Promise<ChannelNpcLookup | null>;
  findCronOriginChannel(key: {
    gatewayId: string;
    profileName: string;
    jobId: string;
  }): Promise<{ channelId: string; gatewayId: string } | null>;
  /** 채널의 사무실 방 id. 못 만들면 null — 게시만 건너뛴다. */
  ensureOfficeRoomId(channelId: string): Promise<string | null>;
  appendRoomMessage(args: {
    roomId: string;
    senderKind: "npc" | "system";
    senderId: string | null;
    senderName: string;
    content: string;
    notice: RoomNotice;
  }): Promise<RoomMessage>;
  emitChannel(channelId: string, event: string, payload: unknown): void;
  emitRoomMessage(roomId: string, message: RoomMessage): void;
  maxResultLength?: number;
  dedupeLimit?: number;
  /** 기본은 프로세스 전역. 테스트는 자기 것을 꽂는다. */
  state?: AutomationState;
};

export type IngestResult = {
  /** 새로 처리한 사건 수 */
  processed: number;
  /** 이미 본 ID 라 건너뛴 수 */
  duplicates: number;
  /** 사건별 처리 실패 메시지(방송·상태·게시 중 하나가 던진 것). 나머지 사건은 계속 간다. */
  errors: string[];
};

// ---------------------------------------------------------------------------
// 싱크
// ---------------------------------------------------------------------------

export async function ingest(
  channelId: string,
  events: PluginEvent[],
  deps: IngestDeps,
): Promise<IngestResult> {
  const state = channelState(deps.state ?? defaultState, channelId);
  const dedupeLimit = deps.dedupeLimit ?? DEFAULT_DEDUPE_LIMIT;
  const result: IngestResult = { processed: 0, duplicates: 0, errors: [] };

  for (const event of events) {
    if (state.seen.has(event.id)) {
      result.duplicates += 1;
      continue;
    }
    remember(state.seen, event.id, dedupeLimit);
    result.processed += 1;

    try {
      broadcast(channelId, event, deps);
      await updateWorking(channelId, event, state, deps);
      await postNotice(channelId, event, deps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${event.kind} ${event.id}: ${message}`);
      console.warn(`[automation-events] ${channelId} ${event.kind} ${event.id} failed: ${message}`);
    }
  }
  return result;
}

function remember(seen: Set<string>, id: string, limit: number) {
  seen.add(id);
  while (seen.size > limit) {
    const oldest = seen.values().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

// ---- (a) 방송 -------------------------------------------------------------

function broadcast(channelId: string, event: PluginEvent, deps: IngestDeps) {
  const name = event.kind.startsWith("cron.")
    ? AUTOMATION_SOCKET_EVENTS.cron
    : AUTOMATION_SOCKET_EVENTS.kanban;
  deps.emitChannel(channelId, name, { channelId, event });
}

// ---- (b) 맵 상태 ----------------------------------------------------------

function profileOf(event: PluginEvent): string | null {
  if (typeof event.profile === "string" && event.profile) return event.profile;
  const p = event.payload;
  if (typeof p.profile === "string" && p.profile) return p.profile;
  if (typeof p.assignee === "string" && p.assignee) return p.assignee;
  return null;
}

function cronRunKey(event: PluginEvent): string | null {
  if (typeof event.run_id === "string" && event.run_id) return event.run_id;
  const p = event.payload as Partial<CronRunStartedPayload>;
  if (typeof p.session_id === "string" && p.session_id) return `session:${p.session_id}`;
  if (typeof event.job_id === "string" && event.job_id) return `job:${event.job_id}`;
  return null;
}

async function updateWorking(
  channelId: string,
  event: PluginEvent,
  state: ChannelState,
  deps: IngestDeps,
) {
  const touched = new Set<string>();

  const add = async (kind: keyof NpcWork, key: string | null) => {
    const profile = profileOf(event);
    if (!profile || !key) return;
    const lookup = await deps.findNpcByProfile(channelId, profile);
    // 잠든 NPC 도 집계한다 — 다시 출근하면 그 시점의 값이 맞아야 한다.
    if (!lookup?.npc) return;
    let work = state.work.get(lookup.npc.id);
    if (!work) {
      work = { runningCards: new Set(), cronRuns: new Set() };
      state.work.set(lookup.npc.id, work);
    }
    work[kind].add(key);
    touched.add(lookup.npc.id);
  };

  // 종료 사건에는 프로필이 실리지 않을 수 있다(terminate 등). 키로 모든 NPC 를 뒤진다.
  const remove = (kind: keyof NpcWork, key: string | null) => {
    if (!key) return;
    for (const [npcId, work] of state.work) {
      if (work[kind].delete(key)) touched.add(npcId);
    }
  };

  switch (event.kind) {
    case "task.run.started":
      await add("runningCards", event.task_id ?? null);
      break;
    case "task.run.finished":
      remove("runningCards", event.task_id ?? null);
      break;
    case "cron.run.started":
      await add("cronRuns", cronRunKey(event));
      break;
    case "cron.run.finished":
      remove("cronRuns", cronRunKey(event));
      break;
    default:
      return;
  }

  for (const npcId of touched) {
    const work = state.work.get(npcId);
    if (!work) continue;
    const payload = workingPayload(npcId, work);
    const serialized = JSON.stringify(payload);
    if (state.lastEmitted.get(npcId) === serialized) continue;
    state.lastEmitted.set(npcId, serialized);
    deps.emitChannel(channelId, AUTOMATION_SOCKET_EVENTS.working, payload);
    if (!payload.working) state.work.delete(npcId);
  }
}

// ---- (c) 방 알림 ----------------------------------------------------------

type Sender = {
  senderKind: "npc" | "system";
  senderId: string | null;
  senderName: string;
  npcName: string;
};

/**
 * 담당 NPC 를 발신자로 푼다. 출근 중이면 NPC 발화, 잠들었거나 없으면 시스템 메시지(R22).
 * 프로필조차 없으면 프로필 이름을 그대로 쓴다 — 이름을 몰라도 알림은 나가야 한다.
 */
async function resolveSender(
  channelId: string,
  profile: string | null,
  deps: IngestDeps,
): Promise<Sender> {
  if (!profile) return { senderKind: "system", senderId: null, senderName: "", npcName: "" };
  const lookup = await deps.findNpcByProfile(channelId, profile);
  const npcName = lookup?.displayName || profile;
  if (lookup?.npc?.active) {
    return { senderKind: "npc", senderId: lookup.npc.id, senderName: npcName, npcName };
  }
  return { senderKind: "system", senderId: null, senderName: npcName, npcName };
}

function withPrefix(sender: Sender, body: string): string {
  return sender.senderKind === "system" && sender.npcName ? `${sender.npcName}: ${body}` : body;
}

async function post(
  channelId: string,
  sender: Sender,
  body: string,
  notice: RoomNotice,
  deps: IngestDeps,
) {
  const roomId = await deps.ensureOfficeRoomId(channelId);
  if (!roomId) {
    console.warn(`[automation-events] ${channelId}: office room unavailable, notice dropped`);
    return;
  }
  const message = await deps.appendRoomMessage({
    roomId,
    senderKind: sender.senderKind,
    senderId: sender.senderId,
    senderName: sender.senderName,
    content: withPrefix(sender, body),
    notice,
  });
  deps.emitRoomMessage(roomId, message);
}

async function postNotice(channelId: string, event: PluginEvent, deps: IngestDeps) {
  if (event.kind === "task.status") {
    const p = event.payload as Partial<TaskStatusEventPayload>;
    const kind =
      p.to === "blocked"
        ? "card_blocked"
        : p.to === "done" && (p.parent_count ?? 0) === 0
          ? "card_done"
          : null;
    if (!kind) return;
    const sender = await resolveSender(channelId, p.assignee ?? null, deps);
    const cardTitle = typeof p.title === "string" ? p.title : (event.task_id ?? "");
    await post(
      channelId,
      sender,
      cardTitle,
      {
        kind,
        cardId: event.task_id ?? "",
        cardTitle,
        boardSlug: event.board ?? deps.boardSlug,
        npcName: sender.npcName,
      },
      deps,
    );
    return;
  }

  if (event.kind === "cron.run.finished") {
    const p = event.payload as Partial<CronRunFinishedPayload>;
    const profileName = profileOf(event);
    const jobId = event.job_id ?? p.job_id ?? null;
    if (!profileName || !jobId) return;

    // 출처가 이 채널인 작업만(R30). 게이트웨이가 다르면 없는 셈 친다.
    const origin = await deps.findCronOriginChannel({
      gatewayId: deps.gatewayId,
      profileName,
      jobId,
    });
    if (!origin || origin.gatewayId !== deps.gatewayId || origin.channelId !== channelId) return;

    const status: "ok" | "error" = p.status === "error" ? "error" : "ok";
    const text = typeof p.result_text === "string" ? p.result_text.trim() : "";
    const max = deps.maxResultLength ?? DEFAULT_RESULT_MAX_CHARS;
    const body = text
      ? text.length > max
        ? `${text.slice(0, max)}…`
        : text
      : status === "error"
        ? "실행 실패"
        : "결과 없음";
    const sender = await resolveSender(channelId, profileName, deps);
    await post(
      channelId,
      sender,
      body,
      {
        kind: "cron_result",
        jobId,
        jobName: typeof p.job_name === "string" ? p.job_name : jobId,
        npcName: sender.npcName,
        status,
      },
      deps,
    );
  }
}

// ---------------------------------------------------------------------------
// 실제 배선 — DB 조회·방 저장. 폴러(그리고 나중의 푸시 라우트)가 이걸로 deps 를 만든다.
// ---------------------------------------------------------------------------

export type LiveIngestWiring = {
  gatewayId: string;
  boardSlug: string;
  emitChannel: IngestDeps["emitChannel"];
  emitRoomMessage: IngestDeps["emitRoomMessage"];
};

export function createLiveIngestDeps(wiring: LiveIngestWiring): IngestDeps {
  return {
    gatewayId: wiring.gatewayId,
    boardSlug: wiring.boardSlug,
    emitChannel: wiring.emitChannel,
    emitRoomMessage: wiring.emitRoomMessage,

    async findNpcByProfile(channelId, profileName) {
      const [row] = await db
        .select({ profile: hermesProfiles, npc: npcs })
        .from(hermesProfiles)
        .leftJoin(
          npcs,
          and(eq(npcs.hermesProfileId, hermesProfiles.id), eq(npcs.channelId, channelId)),
        )
        .where(
          and(
            eq(hermesProfiles.gatewayId, wiring.gatewayId),
            eq(hermesProfiles.profileName, profileName),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        profileName: row.profile.profileName,
        displayName: row.profile.displayName?.trim() || row.profile.profileName,
        npc: row.npc ? { id: row.npc.id, active: Boolean(row.npc.active) } : null,
      };
    },

    async findCronOriginChannel(key) {
      const origin = resolveOriginForGateway(await findCronOrigin(key), key.gatewayId);
      return origin ? { channelId: origin.channelId, gatewayId: origin.gatewayId } : null;
    },

    async ensureOfficeRoomId(channelId) {
      const ownerId = await getChannelOwnerId(channelId);
      if (!ownerId) return null;
      return (await ensureOfficeRoom(channelId, ownerId)).id;
    },

    appendRoomMessage: (args) => appendRoomMessage(args),
  };
}
