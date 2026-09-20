/**
 * 채널 ↔ Hermes 칸반 보드 연결 (T4).
 *
 * 보드는 **Hermes 가 정본**이다. 카드는 한 장도 여기 저장하지 않는다 — 우리가 남기는 것은
 * `channel_kanban_boards` 의 (채널, 게이트웨이, slug) 연결 기록과 마지막 실패 사유뿐이다.
 *
 * 2026-09-21 부터 **채널은 보드를 여러 개 가진다**(보드 = 프로젝트). 연결 행의 PK 는 대리 키이고
 * `(채널, slug)` 가 유니크다. 그중 정확히 하나가 **사건 수신 보드**(`isEventCarrier`)이고, 게이트웨이
 * 전역 사건(크론·아티팩트)은 그 행에서만 받는다 — 플러그인의 `/deskrpg/events` 가 크론을 보드로
 * 걸러 주지 않기 때문이다. 인자 없는 `getChannelBoard`·`ensureChannelBoard` 는 **사건 수신 보드**를
 * 가리킨다(이관 전의 유일한 보드가 그것이다) — 그래서 기존 호출자는 뜻이 바뀌지 않는다.
 *
 * - slug 는 채널 UUID 에서 결정적으로 나온다(`channelBoardSlug`). 그래서 "보드가 이미
 *   있는가" 를 DB 에 묻지 않아도 된다 — 플러그인의 `POST /deskrpg/kanban/boards` 가 같은
 *   slug 면 기존 보드를 200 으로 돌려주므로 확보는 늘 같은 호출 한 번이다(E1).
 * - 확보 실패는 바인딩을 막지 않는다(R5). 행은 만들되 `last_error` 에 이유를 남기고,
 *   `ensureChannelBoard` 는 멱등이라 다음 화면 진입·폴링이 그대로 다시 부르면 된다.
 * - 플러그인 계약(0.6.0 + kanban·cron·events)에 못 미치면 칸반 경로를 **건드리지 않는다**
 *   (R31). 판정은 `automation-gate.ts` 의 단일 게이트가 한다 — 크론 REST 도 같은 함수를 쓴다.
 * - 어떤 함수도 호출자에게 던지지 않는다. 바인딩·개명 라우트가 이 모듈의 실패 때문에
 *   실패하면 안 되기 때문이다.
 */

import { randomBytes } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import { gateAutomationPlugin, type PluginGate } from "@/lib/automation-gate";
import { channelKanbanBoards, channelProjects, channels, db, nowForDb } from "@/db";

/**
 * 끝난 프로젝트의 상태. `project-registry` 의 것과 같은 값이며, 여기서 그 모듈을 import 하면
 * 순환이 생겨(그쪽이 이 파일을 쓴다) 작은 사본을 둔다.
 */
const ARCHIVED_PROJECT_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);
import { decryptGatewayToken, getChannelGatewayBinding } from "@/lib/gateway-resources";
import type { BoardMeta } from "@/lib/hermes/deskrpg-plugin-types";
import { createOwnerPluginClient, type OwnerPluginClient } from "@/lib/hermes/plugin-client";
import { transportFetch } from "@/lib/hermes/setup/transport";

export type { PluginGate } from "@/lib/automation-gate";

export type ChannelBoardRow = typeof channelKanbanBoards.$inferSelect;

/** 확보·동기화가 실패한 이유. `channel_kanban_boards.last_error` 에 그대로 남는다. */
export type ChannelBoardFailureCode =
  | "unbound"
  | "channel_not_found"
  | "no_board"
  | "plugin_absent"
  | "plugin_unauthorized"
  | "plugin_unknown"
  | "plugin_upgrade_required"
  | "internal_error"
  // 플러그인 클라이언트가 돌려준 실패 코드(unreachable·timeout·malformed_response·플러그인의 error 값)
  | (string & {});

export type ChannelBoardResult =
  | { ok: true; board: BoardMeta; row: ChannelBoardRow }
  | { ok: false; code: ChannelBoardFailureCode; reason: string; row: ChannelBoardRow | null };

export type ResolvedChannelBoard =
  | {
      ok: true;
      binding: NonNullable<Awaited<ReturnType<typeof getChannelGatewayBinding>>>;
      ownerClient: OwnerPluginClient;
      boardSlug: string;
      pluginGate: PluginGate;
    }
  | { ok: false; code: "unbound"; reason: string };

/**
 * 채널 UUID → 보드 slug. `deskrpg-` + 하이픈을 뺀 32자(소문자).
 * 플러그인의 slug 규칙(`[a-z0-9-]{1,64}`)에 맞고, 채널마다 유일하며, 다시 계산해도 같다.
 */
export function channelBoardSlug(channelId: string): string {
  return `deskrpg-${channelId.replace(/-/g, "").toLowerCase()}`;
}

/**
 * 둘째 보드부터 쓰는 slug. 첫 보드(= 사건 수신 보드)는 `channelBoardSlug` 그대로다 — Hermes 의
 * 카드 DB 가 `board_dir(slug)` 아래에 있고 slug 를 바꾸는 라우트가 없어서, 이미 있는 보드의
 * slug 는 건드릴 수 없다. 접미사 8자를 붙여도 `deskrpg-`(8) + 32 + `-`(1) + 8 = 49자라
 * 플러그인의 64자 상한 안이다.
 */
export function newChannelBoardSlug(channelId: string): string {
  return `${channelBoardSlug(channelId)}-${randomBytes(4).toString("hex")}`;
}

/**
 * 채널의 **사건 수신 보드** 행. 인자 하나짜리 옛 호출자가 기대하던 "그 채널의 보드" 가 이것이다.
 * 아직 carrier 가 정해지지 않은 옛 행이 있을 수 있어, 없으면 가장 먼저 만들어진 행으로 떨어진다.
 */
export async function getChannelBoard(channelId: string): Promise<ChannelBoardRow | null> {
  const rows = await listChannelBoards(channelId);
  return rows.find((row) => row.isEventCarrier) ?? rows[0] ?? null;
}

/** 채널에 붙은 보드 전부. 만들어진 순서 — 첫 행이 보통 사건 수신 보드다. */
export async function listChannelBoards(channelId: string): Promise<ChannelBoardRow[]> {
  return db
    .select()
    .from(channelKanbanBoards)
    .where(eq(channelKanbanBoards.channelId, channelId))
    .orderBy(channelKanbanBoards.createdAt);
}

/**
 * 채널에 사건 수신 보드가 하나도 없으면 하나를 세운다. **읽는 쪽이 고치는 자가 복구**다.
 *
 * 부분 유니크 인덱스는 carrier 가 **둘**인 것은 막지만 **0개**인 것은 막지 못한다. 보관이
 * carrier 를 옮기는 두 UPDATE 사이에 프로세스가 죽으면 그 채널은 크론 사건을 아무도 받지 않고,
 * 화면은 멀쩡한데 카드만 안 움직이는 조용한 실패가 된다. 보상 로직은 "②가 실패했을 때" 만
 * 막고 "①과 ② 사이에 죽었을 때" 는 못 막는다 — 그 경로는 이 함수만 막는다.
 *
 * 규칙은 0017 의 조건부 UPDATE 와 같다: **가장 오래된 보드 하나**. 다만 보관된 프로젝트의 보드는
 * 후보에서 뺀다 — 끝난 일의 보드를 사건 수신 자리로 되살리면 보관의 뜻이 무너진다.
 * 후보가 전부 보관됐으면 그래도 하나는 세운다(아무도 안 받는 것보다 낫다).
 */
export async function ensureChannelCarrier(channelId: string): Promise<ChannelBoardRow | null> {
  const rows = await listChannelBoards(channelId);
  if (rows.length === 0) return null;
  const current = rows.find((row) => row.isEventCarrier);
  if (current) return current;

  const archivedLinkIds = new Set(
    (
      await db
        .select({ boardLinkId: channelProjects.boardLinkId, status: channelProjects.status })
        .from(channelProjects)
        .where(eq(channelProjects.channelId, channelId))
    )
      .filter((row) => ARCHIVED_PROJECT_STATUSES.has(row.status))
      .map((row) => row.boardLinkId),
  );

  const candidate = rows.find((row) => !archivedLinkIds.has(row.id)) ?? rows[0];
  const [restored] = await db
    .update(channelKanbanBoards)
    .set({ isEventCarrier: true, updatedAt: nowForDb() })
    .where(eq(channelKanbanBoards.id, candidate.id))
    .returning();
  console.warn(
    `[kanban-boards] channel ${channelId} had no event carrier; restored ${candidate.boardSlug}`,
  );
  return restored ?? candidate;
}

/**
 * 이 채널에 **그 slug 로 붙어 있는** 보드 행. 없으면 null — 호출자는 404 로 답해야 한다.
 * 다른 채널의 보드를 slug 로 집어 오는 것을 막는 유일한 관문이라 채널 조건을 뺄 수 없다.
 */
export async function getChannelBoardBySlug(
  channelId: string,
  boardSlug: string,
): Promise<ChannelBoardRow | null> {
  const [row] = await db
    .select()
    .from(channelKanbanBoards)
    .where(
      and(
        eq(channelKanbanBoards.channelId, channelId),
        eq(channelKanbanBoards.boardSlug, boardSlug),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * 뒤의 태스크(칸반 라우트·폴러)가 재사용하는 진입점 — 바인딩·오너 클라이언트·slug·플러그인
 * 게이트를 한 번에 푼다. 바인딩이 없으면 `unbound`. 게이트 실패는 `pluginGate.ok=false` 로
 * 돌려주고 여기서는 아무것도 기록하지 않는다(기록은 `ensureChannelBoard` 의 몫).
 */
export async function resolveChannelBoard(channelId: string): Promise<ResolvedChannelBoard> {
  const binding = await getChannelGatewayBinding(channelId);
  if (!binding) {
    return { ok: false, code: "unbound", reason: "channel has no gateway binding" };
  }
  const ownerToken = decryptGatewayToken(binding.resource.tokenEncrypted);
  const ownerClient = createOwnerPluginClient({
    baseUrl: binding.resource.baseUrl,
    ownerToken,
    fetchImpl: transportFetch,
  });
  const pluginGate = await gateAutomationPlugin(binding.resource, ownerToken);
  return { ok: true, binding, ownerClient, boardSlug: channelBoardSlug(channelId), pluginGate };
}

/**
 * 게이트웨이가 바뀌었으면 그 채널의 보드 행을 **새 게이트웨이로 옮긴다**(R4).
 *
 * 예전에는 행을 지우고 새로 만들었다. 이제는 그럴 수 없다 — `channel_projects.board_link_id` 가
 * cascade 로 연결 행을 물고 있어서, 행을 지우면 프로젝트 메타(상태·목표일·출처 회의)가 함께
 * 사라진다. 결정 D-1 은 "메타는 남기고 연결만 다시 붙인다" 이므로 행 id 를 유지한 채
 * 게이트웨이만 갈아 끼우고, **이전 게이트웨이의 것인 커서와 동기화 시각은 버린다**.
 *
 * 카드는 새 게이트웨이에 없을 수 있다. 그것은 화면이 말해야 할 사실이지 여기서 숨길 일이 아니다.
 */
async function migrateChannelBoardsToGateway(channelId: string, gatewayId: string): Promise<void> {
  await db
    .update(channelKanbanBoards)
    .set({
      gatewayId,
      eventCursor: null,
      boardNameSyncedAt: null,
      lastError: null,
      updatedAt: nowForDb(),
    })
    .where(
      and(
        eq(channelKanbanBoards.channelId, channelId),
        ne(channelKanbanBoards.gatewayId, gatewayId),
      ),
    );
}

/**
 * 연결 행을 쓴다 — 키는 `(채널, slug)` 다. 그 채널에 아직 보드가 하나도 없으면 만들어지는 행이
 * **사건 수신 보드**가 된다(크론·아티팩트를 받는 자리는 채널마다 정확히 하나다).
 */
async function upsertBoardRow(input: {
  channelId: string;
  gatewayId: string;
  boardSlug: string;
  lastError: string | null;
  boardNameSyncedAt?: Date | null;
}): Promise<ChannelBoardRow> {
  await migrateChannelBoardsToGateway(input.channelId, input.gatewayId);
  const now = nowForDb();
  const existing = await getChannelBoardBySlug(input.channelId, input.boardSlug);

  if (existing) {
    const [updated] = await db
      .update(channelKanbanBoards)
      .set({
        lastError: input.lastError,
        ...(input.boardNameSyncedAt === undefined
          ? {}
          : { boardNameSyncedAt: input.boardNameSyncedAt }),
        updatedAt: now,
      })
      .where(eq(channelKanbanBoards.id, existing.id))
      .returning();
    return updated;
  }

  // 첫 보드가 사건 수신 보드다. 부분 유니크 인덱스가 둘째 carrier 를 막는다.
  const carrierExists = (await listChannelBoards(input.channelId)).some((r) => r.isEventCarrier);
  const [created] = await db
    .insert(channelKanbanBoards)
    .values({
      channelId: input.channelId,
      gatewayId: input.gatewayId,
      boardSlug: input.boardSlug,
      isEventCarrier: !carrierExists,
      boardNameSyncedAt: input.boardNameSyncedAt ?? null,
      lastError: input.lastError,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

async function readChannelName(channelId: string): Promise<string | null> {
  const [channel] = await db
    .select({ name: channels.name })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return channel?.name ?? null;
}

/**
 * 채널의 보드를 확보한다 — slug 가 있으면 재사용, 없으면 생성(R1). 멱등이며 던지지 않는다.
 * 실패해도 연결 행은 남고 `last_error` 에 이유가 적힌다(R5).
 *
 * 호출자가 이미 `resolveChannelBoard` 를 풀었으면 `resolved` 로 넘긴다 — 게이트·클라이언트를
 * 한 요청에서 두 번 만들지 않기 위해서다(칸반 접근 제어·폴러).
 */
export async function ensureChannelBoard(
  channelId: string,
  resolved?: ResolvedChannelBoard,
  /**
   * 확보할 보드. 생략하면 그 채널의 기본 보드(= 사건 수신 보드) slug 다. 이미 붙어 있는 보드를
   * 다시 확보할 때는 그 보드의 이름을 Hermes 가 갖고 있으므로 채널 이름으로 덮어쓰지 않는다 —
   * 플러그인의 `POST /kanban/boards` 는 같은 slug 면 기존 보드를 이름째 돌려준다.
   */
  requestedSlug?: string,
): Promise<ChannelBoardResult> {
  try {
    resolved ??= await resolveChannelBoard(channelId);
    if (!resolved.ok) return { ok: false, code: resolved.code, reason: resolved.reason, row: null };

    const name = await readChannelName(channelId);
    if (name === null) {
      return { ok: false, code: "channel_not_found", reason: "channel not found", row: null };
    }

    const gatewayId = resolved.binding.resource.id;
    const boardSlug = requestedSlug ?? resolved.boardSlug;

    if (!resolved.pluginGate.ok) {
      const row = await upsertBoardRow({
        channelId,
        gatewayId,
        boardSlug,
        lastError: resolved.pluginGate.code,
      });
      return { ok: false, code: resolved.pluginGate.code, reason: resolved.pluginGate.reason, row };
    }

    const created = await resolved.ownerClient.kanban.createBoard({ slug: boardSlug, name });
    if (!created.ok) {
      const row = await upsertBoardRow({
        channelId,
        gatewayId,
        boardSlug,
        lastError: created.failure.code,
      });
      return {
        ok: false,
        code: created.failure.code,
        reason: created.failure.message || created.failure.code,
        row,
      };
    }

    const row = await upsertBoardRow({
      channelId,
      gatewayId,
      boardSlug,
      lastError: null,
      boardNameSyncedAt: nowForDb(),
    });
    return { ok: true, board: created.data.board, row };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[kanban-boards] ensureChannelBoard(${channelId}) failed: ${reason}`);
    return { ok: false, code: "internal_error", reason, row: null };
  }
}

/**
 * 채널 이름 변경을 보드 표시 이름에 반영한다(R2). 실패해도 던지지 않고
 * `board_name_synced_at` 은 건드리지 않는다 — 폴러가 그 시각을 채널의 `updated_at` 과 견줘
 * 뒤처져 있으면 한 바퀴에 한 번 다시 부른다(게이트를 통과한 바퀴에서만).
 */
export async function syncBoardName(
  channelId: string,
  name: string,
  resolved?: ResolvedChannelBoard,
): Promise<ChannelBoardResult> {
  try {
    const existing = await getChannelBoard(channelId);
    if (!existing) {
      return { ok: false, code: "no_board", reason: "channel has no board row", row: null };
    }

    resolved ??= await resolveChannelBoard(channelId);
    if (!resolved.ok)
      return { ok: false, code: resolved.code, reason: resolved.reason, row: existing };

    const gatewayId = resolved.binding.resource.id;
    if (!resolved.pluginGate.ok) {
      const row = await upsertBoardRow({
        channelId,
        gatewayId,
        boardSlug: existing.boardSlug,
        lastError: resolved.pluginGate.code,
      });
      return { ok: false, code: resolved.pluginGate.code, reason: resolved.pluginGate.reason, row };
    }

    const updated = await resolved.ownerClient.kanban.updateBoard(existing.boardSlug, { name });
    if (!updated.ok) {
      const row = await upsertBoardRow({
        channelId,
        gatewayId,
        boardSlug: existing.boardSlug,
        lastError: updated.failure.code,
      });
      return {
        ok: false,
        code: updated.failure.code,
        reason: updated.failure.message || updated.failure.code,
        row,
      };
    }

    const row = await upsertBoardRow({
      channelId,
      gatewayId,
      boardSlug: existing.boardSlug,
      lastError: null,
      boardNameSyncedAt: nowForDb(),
    });
    return { ok: true, board: updated.data.board, row };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[kanban-boards] syncBoardName(${channelId}) failed: ${reason}`);
    return { ok: false, code: "internal_error", reason, row: null };
  }
}
