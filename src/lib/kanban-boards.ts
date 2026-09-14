/**
 * 채널 ↔ Hermes 칸반 보드 연결 (T4).
 *
 * 보드는 **Hermes 가 정본**이다. 카드는 한 장도 여기 저장하지 않는다 — 우리가 남기는 것은
 * `channel_kanban_boards` 의 (채널, 게이트웨이, slug) 연결 기록과 마지막 실패 사유뿐이다.
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

import { eq } from "drizzle-orm";

import { gateAutomationPlugin, type PluginGate } from "@/lib/automation-gate";
import { channelKanbanBoards, channels, db, nowForDb } from "@/db";
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

export async function getChannelBoard(channelId: string): Promise<ChannelBoardRow | null> {
  const [row] = await db
    .select()
    .from(channelKanbanBoards)
    .where(eq(channelKanbanBoards.channelId, channelId))
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
 * 연결 행을 쓴다. 게이트웨이가 바뀌었으면 행을 **새로** 만든다(R4 — 커서·동기화 시각은 이전
 * 게이트웨이의 것이라 같이 버린다). 같은 게이트웨이면 준 필드만 갱신한다.
 */
async function upsertBoardRow(input: {
  channelId: string;
  gatewayId: string;
  boardSlug: string;
  lastError: string | null;
  boardNameSyncedAt?: Date | null;
}): Promise<ChannelBoardRow> {
  const existing = await getChannelBoard(input.channelId);
  const now = nowForDb();

  if (existing && existing.gatewayId === input.gatewayId) {
    const [updated] = await db
      .update(channelKanbanBoards)
      .set({
        boardSlug: input.boardSlug,
        lastError: input.lastError,
        ...(input.boardNameSyncedAt === undefined
          ? {}
          : { boardNameSyncedAt: input.boardNameSyncedAt }),
        updatedAt: now,
      })
      .where(eq(channelKanbanBoards.channelId, input.channelId))
      .returning();
    return updated;
  }

  if (existing) {
    await db.delete(channelKanbanBoards).where(eq(channelKanbanBoards.channelId, input.channelId));
  }
  const [created] = await db
    .insert(channelKanbanBoards)
    .values({
      channelId: input.channelId,
      gatewayId: input.gatewayId,
      boardSlug: input.boardSlug,
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
): Promise<ChannelBoardResult> {
  try {
    resolved ??= await resolveChannelBoard(channelId);
    if (!resolved.ok) return { ok: false, code: resolved.code, reason: resolved.reason, row: null };

    const name = await readChannelName(channelId);
    if (name === null) {
      return { ok: false, code: "channel_not_found", reason: "channel not found", row: null };
    }

    const gatewayId = resolved.binding.resource.id;
    const boardSlug = resolved.boardSlug;

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
