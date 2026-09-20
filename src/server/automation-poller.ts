/**
 * 자동화 사건 폴러 (T5, R23·R24·E6·E7).
 *
 * 묶인 채널마다 플러그인의 변화 목록(`/deskrpg/events?board=…&cursor=…`)을 주기적으로 읽어
 * 사건 싱크 `ingest()` 에 넘긴다. 브라우저는 Hermes 를 직접 부르지 않는다(R26) — 이 폴러가
 * 서버 안에서 유일하게 사건을 끌어온다.
 *
 * - 기준점 토큰은 채널(+게이트웨이) 단위로 `channel_kanban_boards.event_cursor` 에 산다.
 *   토큰이 없으면(첫 연결·게이트웨이 교체) cursor 없이 불러 "지금" 토큰만 받고 **과거는
 *   재생하지 않는다**(R23). 플러그인이 400 `unknown_cursor` 를 주면 같은 방법으로 다시
 *   시작한다(E7).
 * - 주기: 채널에 접속 소켓이 있으면 짧게(기본 5초), 없으면 길게(기본 60초). 화면에서
 *   조작한 직후에는 `pollNow(channelId)` 로 한 번 즉시(R24).
 * - 실패는 던지지 않고 `last_error` 에 남긴다. 성공하면 null 로 지우고 `last_polled_at` 을
 *   찍는다(E6).
 * - 보드 확보 실패(`board_name_synced_at` 이 한 번도 찍히지 않음)는 바퀴마다 다시 확보한다 —
 *   플러그인을 올린 뒤 다음 바퀴가 보드를 만든다(R5). 채널 개명 뒤 이름 동기화가 실패했으면
 *   (`board_name_synced_at` 이 채널 `updated_at` 보다 앞섬) 게이트를 통과한 바퀴에서 한 번 다시
 *   맞춘다(R2).
 * - 타이머는 전부 `unref()` 다 — 테스트 러너와 CLI 종료를 붙들지 않는다.
 *
 * 순수 한 바퀴(`pollChannelOnce`)와 타이머 레지스트리(`createAutomationPoller`)를 나눠 둔다.
 * 테스트는 앞을 직접 부르고, 서버는 뒤의 프로세스 전역 인스턴스를 쓴다.
 */

import { eq } from "drizzle-orm";
import type { Server } from "socket.io";

import { channelGatewayBindings, channelKanbanBoards, channels, db, nowForDb } from "@/db";
import { registerAutomationHooks, unregisterAutomationHooks } from "@/lib/automation-registry";
import type { PluginEvent } from "@/lib/hermes/deskrpg-plugin-types";
import {
  ensureChannelBoard,
  ensureChannelCarrier,
  listChannelBoards,
  resolveChannelBoard,
  syncBoardName,
  type ChannelBoardRow,
  type ResolvedChannelBoard,
} from "@/lib/kanban-boards";
import type { RoomMessage } from "@/lib/chat-rooms-policy";
import { broadcastRoomMessage } from "./room-socket";
import {
  createLiveIngestDeps,
  getWorkingSnapshot,
  ingest,
  type IngestDeps,
} from "./automation-events";

// ---------------------------------------------------------------------------
// 조정값
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const POLL_DEFAULTS = {
  /** 채널에 접속 소켓이 있을 때 */
  activeMs: envInt("AUTOMATION_POLL_ACTIVE_MS", 5_000),
  /** 아무도 없을 때 */
  idleMs: envInt("AUTOMATION_POLL_IDLE_MS", 60_000),
  /** 한 페이지에 받을 사건 수 */
  pageLimit: envInt("AUTOMATION_POLL_PAGE_LIMIT", 200),
  /** `has_more` 를 따라가는 페이지 수 상한 — 한 바퀴가 무한히 길어지지 않게 */
  maxPages: envInt("AUTOMATION_POLL_MAX_PAGES", 10),
} as const;

// ---------------------------------------------------------------------------
// 한 바퀴
// ---------------------------------------------------------------------------

export type PollOnceDeps = {
  resolveBoard: typeof resolveChannelBoard;
  ensureBoard: typeof ensureChannelBoard;
  /** 그 채널에 붙은 보드 **전부**. 보드마다 커서가 따로라 한 바퀴에 모두 돈다. */
  readRows: typeof listChannelBoards;
  /** carrier 가 0개로 떨어진 채널을 되살린다 — 읽는 쪽이 고치는 자가 복구. */
  ensureCarrier: typeof ensureChannelCarrier;
  /** 재시작 뒤 "일하는 중" 을 보드에서 되세운다. 프로세스 수명당 채널마다 한 번. */
  resyncWorking(
    channelId: string,
    rows: ChannelBoardRow[],
    resolved: Extract<ResolvedChannelBoard, { ok: true }>,
    deps: PollOnceDeps,
  ): Promise<void>;
  /** 채널 이름과 마지막 수정 시각 — 보드 이름 동기화가 뒤처졌는지 판정한다(R2). */
  readChannel(channelId: string): Promise<{ name: string; updatedAt: Date | string | null } | null>;
  syncBoardName: typeof syncBoardName;
  /** **연결 행 id** 로 쓴다. channel_id 로 쓰면 그 채널의 다른 보드 커서까지 덮어쓴다. */
  saveRow(
    boardLinkId: string,
    patch: { eventCursor?: string; lastError: string | null },
  ): Promise<void>;
  makeIngestDeps(ctx: { channelId: string; gatewayId: string; boardSlug: string }): IngestDeps;
  ingest: typeof ingest;
  pageLimit: number;
  maxPages: number;
};

/** 보드 하나의 결과. */
export type BoardPollOutcome =
  | {
      ok: true;
      boardSlug: string;
      events: number;
      pages: number;
      cursor: string;
      restarted: boolean;
    }
  | { ok: false; boardSlug: string; code: string; reason: string };

/**
 * 채널 한 바퀴의 결과. `events` 는 보드들의 합이고 `cursor` 는 **사건 수신 보드**의 것이다 —
 * 채널 단위 결과를 기대하던 호출자가 뜻을 잃지 않게 한다. 보드별 결과는 `boards` 에 있다.
 */
export type PollOutcome =
  | {
      ok: true;
      events: number;
      pages: number;
      cursor: string;
      restarted: boolean;
      boards?: BoardPollOutcome[];
    }
  | { ok: false; code: string; reason: string; boards?: BoardPollOutcome[] };

async function saveBoardRow(
  boardLinkId: string,
  patch: { eventCursor?: string; lastError: string | null },
) {
  const now = nowForDb();
  await db
    .update(channelKanbanBoards)
    .set({
      ...(patch.eventCursor === undefined ? {} : { eventCursor: patch.eventCursor }),
      lastError: patch.lastError,
      lastPolledAt: now,
      updatedAt: now,
    })
    .where(eq(channelKanbanBoards.id, boardLinkId));
}

async function readChannelNameAndUpdatedAt(
  channelId: string,
): Promise<{ name: string; updatedAt: Date | string | null } | null> {
  const [row] = await db
    .select({ name: channels.name, updatedAt: channels.updatedAt })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return row ? { name: row.name, updatedAt: row.updatedAt } : null;
}

/** SQLite 는 ISO 문자열, PostgreSQL 은 Date — 둘 다 밀리초로. 못 읽으면 null. */
function toMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/**
 * 보드 이름이 채널 이름보다 뒤처졌는가 — 동기화 시각이 없거나 채널 `updated_at` 보다 앞서면 참.
 * 채널의 `updated_at` 을 모르면(옛 행) 동기화 시각이 있는 한 맞다고 본다.
 */
export function boardNameStale(
  row: Pick<ChannelBoardRow, "boardNameSyncedAt">,
  channelUpdatedAt: Date | string | null,
): boolean {
  const synced = toMillis(row.boardNameSyncedAt);
  if (synced === null) return true;
  const updated = toMillis(channelUpdatedAt);
  return updated !== null && synced < updated;
}

export function createDefaultPollDeps(
  emit: Pick<IngestDeps, "emitChannel" | "emitRoomMessage">,
): PollOnceDeps {
  return {
    resolveBoard: resolveChannelBoard,
    ensureBoard: ensureChannelBoard,
    readRows: listChannelBoards,
    ensureCarrier: ensureChannelCarrier,
    resyncWorking: resyncWorkingFromBoards,
    readChannel: readChannelNameAndUpdatedAt,
    syncBoardName,
    saveRow: saveBoardRow,
    makeIngestDeps: (ctx) =>
      createLiveIngestDeps({
        gatewayId: ctx.gatewayId,
        boardSlug: ctx.boardSlug,
        emitChannel: emit.emitChannel,
        emitRoomMessage: emit.emitRoomMessage,
      }),
    ingest,
    pageLimit: POLL_DEFAULTS.pageLimit,
    maxPages: POLL_DEFAULTS.maxPages,
  };
}

/**
 * 채널 하나를 한 바퀴 폴링한다. 어떤 경우에도 던지지 않는다 — 실패는 `last_error` 와
 * 반환값에만 남는다(E6).
 */
/**
 * 이 프로세스에서 "일하는 중" 을 이미 되세운 채널들.
 *
 * 조건을 "채널 상태가 비어 있으면" 으로 잡으면 안 된다 — `ingest` 는 일이 끝나면 엔트리를
 * 지우므로(`automation-events.ts` 의 `if (!payload.working) state.work.delete(npcId)`) 그 조건은
 * 한가한 채널에서도 늘 참이 되고, 아무 일도 없는 채널이 매 바퀴 보드를 조회하게 된다.
 * 프로세스가 죽으면 이 집합도 사라지므로 재시작마다 정확히 한 번 돈다.
 *
 * **보드를 다 읽은 바퀴에만 넣는다.** 재시작은 배포와 겹치는 일이 많아, 이 코드가 도는 바로 그 순간
 * 게이트웨이가 잠깐 안 닿을 수 있다 — 읽기 전에 표시하면 그 채널은 프로세스가 사는 동안 다시
 * 시도하지 않고, 되세우기가 존재하는 이유인 장면에서 조용히 실패한다.
 */
const resyncedChannels = new Set<string>();
/** 지금 되세우는 중인 채널. 같은 채널의 두 바퀴가 겹쳐 합성 사건을 두 번 만들지 않게 한다. */
const resyncInFlight = new Set<string>();

/** 테스트용 — 프로세스 수명 경계를 흉내낸다. */
export function resetWorkingResyncForTests(channelId?: string) {
  if (channelId === undefined) {
    resyncedChannels.clear();
    resyncInFlight.clear();
  } else {
    resyncedChannels.delete(channelId);
    resyncInFlight.delete(channelId);
  }
}

/**
 * 재시작 뒤 "일하는 중" 을 **보드에서 되세운다**(설계 2026-09-21 npc-working-state, 결정 A-1).
 *
 * 상태의 정본은 프로세스 메모리라 재시작 한 번에 전부 사라지고, 폴러는 커서 이후만 읽으므로
 * 지나간 `task.run.started` 는 다시 오지 않는다 — 그대로 두면 카드가 돌고 있는데 화면은
 * "아무도 일하지 않는다" 고 말한다. 보드의 `running` 열에는 담당자와 시작 시각이 남아 있으므로
 * 그것으로 다시 세운다.
 *
 * **`npc:working` 을 여기서 쏘지 않는다.** 방송은 `ingest` 하나가 한다는 불변식(`src/server/AGENTS.md`)을
 * 지키려고, 읽은 카드를 `task.run.started` **모양의 합성 사건**으로 만들어 평소 경로에 흘린다.
 * 그래서 중복 제거(`state.seen`)와 차분 방송(`lastEmitted`)이 그대로 걸리고, 나중에 오는 **진짜**
 * `task.run.finished` 가 같은 `task_id` 로 닫아 준다.
 *
 * 사건 id 는 결정적이다 — 랜덤이면 한 바퀴마다 다시 방송된다.
 */
async function resyncWorkingFromBoards(
  channelId: string,
  rows: ChannelBoardRow[],
  resolved: Extract<ResolvedChannelBoard, { ok: true }>,
  deps: PollOnceDeps,
): Promise<void> {
  if (resyncedChannels.has(channelId) || resyncInFlight.has(channelId)) return;
  resyncInFlight.add(channelId);
  try {
    let readAll = true;
    for (const row of rows) {
      const view = await resolved.ownerClient.kanban.getBoard(row.boardSlug, {
        includeArchived: false,
      });
      if (!view.ok) {
        // 이 바퀴는 실패로 끝난다 — 표시하지 않고 다음 바퀴에 다시 시도한다.
        readAll = false;
        continue;
      }
      const events: PluginEvent[] = [];
      for (const column of view.data.columns) {
        for (const task of column.tasks) {
          if (task.status !== "running" || !task.assignee) continue;
          events.push({
            id: `resync:${row.boardSlug}:${task.id}:${task.started_at ?? ""}`,
            ts: Math.floor(Date.now() / 1000),
            kind: "task.run.started",
            board: row.boardSlug,
            task_id: task.id,
            payload: { assignee: task.assignee, title: task.title },
          });
        }
      }
      if (events.length === 0) continue;
      const ingestDeps = deps.makeIngestDeps({
        channelId,
        gatewayId: resolved.binding.resource.id,
        boardSlug: row.boardSlug,
      });
      await deps.ingest(channelId, events, ingestDeps);
    }
    if (readAll) resyncedChannels.add(channelId);
  } finally {
    resyncInFlight.delete(channelId);
  }
}

/**
 * 보드 하나를 한 바퀴 폴링한다. 던지지 않는다 — 실패는 `last_error` 와 반환값에만 남는다(E6).
 *
 * **사건 수신 보드가 아니면 크론 사건을 버린다.** 플러그인의 `/deskrpg/events` 는 커서를 보드별로
 * 주면서도 크론은 게이트웨이 전역으로 늘 섞어 보내고 옵트아웃이 없다(`events.py` 의 `cron_tail`).
 * 그래서 보드 N개를 각각 폴링하면 같은 크론 사건이 N번 들어온다. 아티팩트는 `include` 로 빼면
 * 되지만 크론은 여기서 거르는 수밖에 없다. 버린 사건은 사건 수신 보드가 이미 받았거나 받는다.
 */
async function pollBoardOnce(
  channelId: string,
  row: ChannelBoardRow,
  resolved: Extract<ResolvedChannelBoard, { ok: true }>,
  deps: PollOnceDeps,
): Promise<BoardPollOutcome> {
  const boardSlug = row.boardSlug;
  const gatewayId = resolved.binding.resource.id;
  const ingestDeps = deps.makeIngestDeps({ channelId, gatewayId, boardSlug });
  let cursor: string | null = row.eventCursor;
  let restarted = false;
  let pages = 0;
  let events = 0;
  const errors: string[] = [];

  while (pages < deps.maxPages) {
    pages += 1;
    const res = await resolved.ownerClient.events.poll({
      board: boardSlug,
      cursor: cursor ?? undefined,
      limit: deps.pageLimit,
      // 아티팩트는 게이트웨이 전역이라 사건 수신 보드에서만 받는다.
      // 제안 사건은 아티팩트와 같은 `artifact_events` 표·같은 커서(`a`)로 온다. 그래서 **두 토큰은 늘 함께**
      // 켠다 — `artifacts` 만 켜면 아티팩트를 읽으며 커서가 지나가 그 사이의 제안이 오류도 로그도 없이
      // 영영 오지 않는다. 제안도 게이트웨이 전역(보드·채널 컬럼이 없다)이라 수신 보드에만 붙인다.
      // 구버전 플러그인은 모르는 토큰을 무시하므로 버전·capability 분기가 필요 없다.
      ...(row.isEventCarrier ? { include: "artifacts,card_proposals" } : {}),
    });

    if (!res.ok) {
      // E7. 플러그인이 커서를 모르면 "지금" 부터 다시 — 재생 없음.
      if (res.failure.code === "unknown_cursor" && cursor !== null) {
        cursor = null;
        restarted = true;
        continue;
      }
      await deps.saveRow(row.id, { lastError: res.failure.code });
      return { ok: false, boardSlug, code: res.failure.code, reason: res.failure.message };
    }

    if (cursor === null) {
      // 커서 없이 부른 응답은 토큰만 받는 것이다. 사건이 실려 와도 재생하지 않는다(R23).
      cursor = res.data.cursor;
      break;
    }

    cursor = res.data.cursor;
    const usable = row.isEventCarrier
      ? res.data.events
      : res.data.events.filter((event: { kind: string }) => !event.kind.startsWith("cron."));
    if (usable.length > 0) {
      const outcome = await deps.ingest(channelId, usable, ingestDeps);
      events += outcome.processed;
      errors.push(...outcome.errors);
    }
    if (!res.data.has_more) break;
  }

  if (cursor === null) {
    // 페이지 상한의 마지막 바퀴에서 unknown_cursor 가 났다 — 토큰 없이 끝났으니 다음 바퀴가 다시 받는다.
    await deps.saveRow(row.id, { lastError: "cursor_unresolved" });
    return {
      ok: false,
      boardSlug,
      code: "cursor_unresolved",
      reason: "page cap reached before a token",
    };
  }
  await deps.saveRow(row.id, {
    eventCursor: cursor,
    lastError: errors.length > 0 ? `ingest_error: ${errors[0]}` : null,
  });
  return { ok: true, boardSlug, events, pages, cursor, restarted };
}

/**
 * 채널 하나를 한 바퀴 폴링한다 — 그 채널에 붙은 **보드 전부**를 돈다. 어떤 경우에도 던지지
 * 않는다(E6). 게이트·오너 클라이언트는 채널당 한 번만 만든다.
 */
export async function pollChannelOnce(channelId: string, deps: PollOnceDeps): Promise<PollOutcome> {
  try {
    const resolved = await deps.resolveBoard(channelId);
    if (!resolved.ok) return { ok: false, code: resolved.code, reason: resolved.reason };
    const gatewayId = resolved.binding.resource.id;

    // 연결 행이 없거나, 게이트웨이가 바뀌었거나, 보드가 한 번도 확보된 적이 없으면(바인딩 때
    // 게이트·생성 실패 — `board_name_synced_at` 이 비어 있다) 기본 보드부터 다시 세운다(R5).
    // 게이트 실패는 `ensureBoard` 가 `last_error` 에 남기므로 여기서 다시 쓰지 않는다.
    let rows = await deps.readRows(channelId);
    const carrier = rows.find((row) => row.isEventCarrier) ?? rows[0];
    if (!carrier || carrier.gatewayId !== gatewayId || carrier.boardNameSyncedAt === null) {
      const ensured = await deps.ensureBoard(channelId, resolved);
      if (!ensured.ok) return { ok: false, code: ensured.code, reason: ensured.reason };
      rows = await deps.readRows(channelId);
    }

    if (!resolved.pluginGate.ok) {
      for (const row of rows) await deps.saveRow(row.id, { lastError: resolved.pluginGate.code });
      return { ok: false, code: resolved.pluginGate.code, reason: resolved.pluginGate.reason };
    }

    // carrier 가 0개로 떨어졌으면 여기서 되살린다 — 아니면 이 채널은 크론 사건을 아무도 안 받는다.
    await deps.ensureCarrier(channelId);
    rows = await deps.readRows(channelId);

    // R2. 채널 개명 뒤 이름 동기화가 실패해 남아 있으면 한 바퀴에 한 번 다시 맞춘다. 채널 이름은
    // **사건 수신 보드**(= 기본 보드)의 것이다 — 다른 보드는 프로젝트마다 제 이름을 갖는다.
    let syncError: string | null = null;
    const channel = await deps.readChannel(channelId);
    const nameTarget = rows.find((row) => row.isEventCarrier);
    if (channel && nameTarget && boardNameStale(nameTarget, channel.updatedAt)) {
      const synced = await deps.syncBoardName(channelId, channel.name, resolved);
      if (!synced.ok) syncError = `board_name_sync: ${synced.code}`;
    }

    const boards: BoardPollOutcome[] = [];
    for (const row of rows) boards.push(await pollBoardOnce(channelId, row, resolved, deps));

    // 재시작 뒤 "일하는 중" 되세우기 — **폴링을 다 비운 뒤에** 돈다(결정 A-1).
    // 커서는 DB 에 남으므로 재시작 뒤 첫 폴링은 꺼져 있던 동안의 사건을 재생한다. 이것을 앞에 두면
    // 재생된 **이전 실행의** `task.run.finished` 가 합성 `started` 와 같은 task_id 를 지워, 실제로
    // 돌고 있는 카드가 "쉬는 중" 으로 뒤집힌다. 뒤에 두면 그 시점의 사실이 마지막에 놓인다.
    await deps.resyncWorking(channelId, rows, resolved, deps);

    const carrierOutcome = boards.find((b) => b.boardSlug === nameTarget?.boardSlug) ?? boards[0];
    const failed = boards.find((b) => !b.ok);
    if (!carrierOutcome || (!carrierOutcome.ok && failed)) {
      const first = failed as Extract<BoardPollOutcome, { ok: false }> | undefined;
      return {
        ok: false,
        code: first?.code ?? "no_board",
        reason: first?.reason ?? "channel has no board row",
        boards,
      };
    }
    if (!carrierOutcome.ok) {
      return { ok: false, code: carrierOutcome.code, reason: carrierOutcome.reason, boards };
    }

    if (syncError) {
      await deps.saveRow(nameTarget?.id ?? "", { lastError: syncError }).catch(() => {});
    }
    return {
      ok: true,
      events: boards.reduce((sum, b) => sum + (b.ok ? b.events : 0), 0),
      pages: boards.reduce((sum, b) => sum + (b.ok ? b.pages : 0), 0),
      cursor: carrierOutcome.cursor,
      restarted: boards.some((b) => b.ok && b.restarted),
      boards,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[automation-poller] ${channelId} poll failed: ${reason}`);
    return { ok: false, code: "internal_error", reason };
  }
}

// ---------------------------------------------------------------------------
// 타이머 레지스트리
// ---------------------------------------------------------------------------

export type PollerRegistryDeps = {
  pollOnce(channelId: string): Promise<PollOutcome>;
  listBoundChannelIds(): Promise<string[]>;
  isChannelBound(channelId: string): Promise<boolean>;
  intervals: { activeMs: number; idleMs: number };
  /**
   * 대기를 거는 방법. 테스트가 가짜 시계를 넣어 실제로 기다리지 않고 주기를 확인한다.
   * 넣지 않으면 전역 타이머를 쓴다.
   */
  timers?: PollerTimers;
};

export type PollerTimers = {
  setTimeout(handler: () => void, delayMs: number): PollerTimerHandle;
  clearTimeout(handle: PollerTimerHandle): void;
};

export type PollerTimerHandle = { unref?: () => void };

const systemTimers: PollerTimers = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Entry = {
  timer: PollerTimerHandle | null;
  active: boolean;
  running: Promise<PollOutcome> | null;
  /** 실행 중에 `pollNow` 가 또 왔다 — 끝나면 한 번 더 돈다. */
  again: boolean;
};

export type AutomationPoller = {
  start(channelId: string): void;
  stop(channelId: string): void;
  has(channelId: string): boolean;
  isActive(channelId: string): boolean;
  /** 접속 소켓 유무가 바뀌면 주기를 바꾼다. 켜질 때는 즉시 한 번 돈다. */
  setActive(channelId: string, hasSockets: boolean): Promise<void>;
  /** 즉시 한 바퀴. 이미 도는 중이면 끝난 뒤 한 번 더. */
  pollNow(channelId: string): Promise<PollOutcome>;
  /** 바인딩 표를 다시 읽어 새 채널은 시작하고 풀린 채널은 멈춘다. */
  refresh(): Promise<void>;
  stopAll(): void;
};

export function createAutomationPoller(deps: PollerRegistryDeps): AutomationPoller {
  const entries = new Map<string, Entry>();
  const timers = deps.timers ?? systemTimers;

  function schedule(channelId: string) {
    const entry = entries.get(channelId);
    if (!entry) return;
    if (entry.timer) timers.clearTimeout(entry.timer);
    const delay = entry.active ? deps.intervals.activeMs : deps.intervals.idleMs;
    entry.timer = timers.setTimeout(() => {
      entry.timer = null;
      void run(channelId);
    }, delay);
    entry.timer.unref?.();
  }

  function run(channelId: string): Promise<PollOutcome> {
    const entry = entries.get(channelId);
    if (!entry) return deps.pollOnce(channelId);
    if (entry.running) {
      entry.again = true;
      return entry.running;
    }
    if (entry.timer) {
      timers.clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.running = deps
      .pollOnce(channelId)
      .catch((err): PollOutcome => ({
        ok: false,
        code: "internal_error",
        reason: err instanceof Error ? err.message : String(err),
      }))
      .then((outcome) => {
        entry.running = null;
        // 바인딩이 풀린 채널은 더 돌지 않는다 — 다시 묶이면 refresh/setActive 가 되살린다.
        if (!outcome.ok && outcome.code === "unbound") {
          poller.stop(channelId);
          return outcome;
        }
        if (entry.again) {
          entry.again = false;
          void run(channelId);
        } else {
          schedule(channelId);
        }
        return outcome;
      });
    return entry.running;
  }

  const poller: AutomationPoller = {
    start(channelId) {
      if (entries.has(channelId)) return;
      entries.set(channelId, { timer: null, active: false, running: null, again: false });
      schedule(channelId);
    },
    stop(channelId) {
      const entry = entries.get(channelId);
      if (!entry) return;
      if (entry.timer) timers.clearTimeout(entry.timer);
      entries.delete(channelId);
    },
    has: (channelId) => entries.has(channelId),
    isActive: (channelId) => entries.get(channelId)?.active ?? false,
    async setActive(channelId, hasSockets) {
      let entry = entries.get(channelId);
      if (!entry) {
        // 서버가 뜬 뒤에 묶인 채널일 수 있다 — 표를 보고 있으면 여기서 시작한다.
        if (!hasSockets || !(await deps.isChannelBound(channelId))) return;
        poller.start(channelId);
        entry = entries.get(channelId)!;
      }
      if (entry.active === hasSockets) return;
      entry.active = hasSockets;
      if (hasSockets) void run(channelId);
      else schedule(channelId);
    },
    async pollNow(channelId) {
      if (!entries.has(channelId)) poller.start(channelId);
      return run(channelId);
    },
    async refresh() {
      const bound = new Set(await deps.listBoundChannelIds());
      for (const channelId of bound) poller.start(channelId);
      for (const channelId of [...entries.keys()]) {
        if (!bound.has(channelId)) poller.stop(channelId);
      }
    },
    stopAll() {
      for (const channelId of [...entries.keys()]) poller.stop(channelId);
    },
  };
  return poller;
}

// ---------------------------------------------------------------------------
// 프로세스 전역 인스턴스 — 소켓 서버가 켜고, REST 라우트·소켓 핸들러가 부른다.
// ---------------------------------------------------------------------------

type ChannelIo = Pick<Server, "to">;

let live: AutomationPoller | null = null;

async function listBoundChannelIds(): Promise<string[]> {
  const rows = await db
    .select({ channelId: channelGatewayBindings.channelId })
    .from(channelGatewayBindings);
  return rows.map((r) => r.channelId);
}

async function isChannelBound(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ channelId: channelGatewayBindings.channelId })
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.channelId, channelId))
    .limit(1);
  return Boolean(row);
}

/**
 * 소켓 서버가 뜰 때 한 번. 묶인 채널 전부의 폴러를 시작한다. 실패해도 던지지 않는다 —
 * 폴러가 못 떠도 채팅·이동은 되어야 한다.
 */
export async function startAutomationPollers(io: ChannelIo): Promise<AutomationPoller> {
  if (live) return live;
  const pollDeps = createDefaultPollDeps({
    emitChannel: (channelId, event, payload) => io.to(channelId).emit(event, payload),
    emitRoomMessage: (roomId, message) => broadcastRoomMessage(io, roomId, message),
  });
  live = createAutomationPoller({
    pollOnce: (channelId) => pollChannelOnce(channelId, pollDeps),
    listBoundChannelIds,
    isChannelBound,
    intervals: { activeMs: POLL_DEFAULTS.activeMs, idleMs: POLL_DEFAULTS.idleMs },
  });
  // REST 라우트(칸반·크론·게이트웨이)는 `@/server/*` 를 직접 import 하지 않고 레지스트리로
  // 이 폴러를 만난다 — 소켓 서버 모듈이 Next 번들에 실리면 빌드가 깨진다.
  registerAutomationHooks({
    pollNow,
    refreshPollers,
    getWorkingSnapshot,
    emitRoomMessage: (roomId, message) => broadcastRoomMessage(io, roomId, message as RoomMessage),
  });
  try {
    await live.refresh();
  } catch (err) {
    console.warn(
      `[automation-poller] initial discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return live;
}

export function stopAutomationPollers(): void {
  live?.stopAll();
  live = null;
  unregisterAutomationHooks();
}

/** 바인딩이 생기거나 풀렸을 때(게이트웨이 라우트가 부른다). 폴러가 아직 없으면 아무 일 없음. */
export async function refreshPollers(): Promise<void> {
  await live?.refresh();
}

export function startChannelPoller(channelId: string): void {
  live?.start(channelId);
}

export function stopChannelPoller(channelId: string): void {
  live?.stop(channelId);
}

/** 채널에 접속 소켓이 있는지 알려 준다. 켜질 때 즉시 한 바퀴 돈다(R24). */
export async function setChannelActive(channelId: string, hasSockets: boolean): Promise<void> {
  await live?.setActive(channelId, hasSockets);
}

/** 화면에서 조작한 직후 한 번 즉시 폴링(R24). REST 라우트가 부른다. 폴러가 없으면 null. */
export async function pollNow(channelId: string): Promise<PollOutcome | null> {
  return live ? live.pollNow(channelId) : null;
}
