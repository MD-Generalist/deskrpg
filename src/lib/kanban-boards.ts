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
 *   (R31). 판정은 `/deskrpg/info` 로 하고 결과는 게이트웨이의 plugin_* 캐시에 남긴다.
 * - 어떤 함수도 호출자에게 던지지 않는다. 바인딩·개명 라우트가 이 모듈의 실패 때문에
 *   실패하면 안 되기 때문이다.
 */

import { eq } from "drizzle-orm";

import { channelKanbanBoards, channels, db, gatewayResources, nowForDb } from "@/db";
import { decryptGatewayToken, getChannelGatewayBinding } from "@/lib/gateway-resources";
import type { BoardMeta, PluginInfo } from "@/lib/hermes/deskrpg-plugin-types";
import {
  buildPluginCacheUpdate,
  buildPluginInfoCacheUpdate,
  restorePluginInfo,
} from "@/lib/hermes/plugin-cache-update";
import {
  meetsAutomationContract,
  probeDeskrpgPluginWithInfo,
  resolvePluginStatusFromCache,
  type PluginStatus,
} from "@/lib/hermes/plugin-capability";
import { createOwnerPluginClient, type OwnerPluginClient } from "@/lib/hermes/plugin-client";
import { transportFetch } from "@/lib/hermes/setup/transport";

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

/** 플러그인 계약 판정. `ok:false` 의 `code` 는 그대로 `last_error` 가 된다. */
export type PluginGate =
  | { ok: true; status: "plugin_ready"; info: PluginInfo }
  | { ok: false; status: PluginStatus; code: ChannelBoardFailureCode; reason: string };

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
 * 게이트웨이의 플러그인 판정을 캐시에서 읽거나(1시간 규칙 — `shouldReprobePlugin`) 다시 찔러
 * 캐시를 채운다. 두 경우는 캐시가 신선해도 다시 찌른다 — 정보가 없는 것이지 판정이 난 것이
 * 아니기 때문이다:
 * - `unknown`(도달 실패·타임아웃) — 한 시간 붙들면 게이트웨이가 살아나도 보드 확보가 막힌다.
 * - `plugin_ready` 인데 `plugin_info_json` 이 비었음 — info 없이 계약을 판정하면 `no_info` 로
 *   `plugin_upgrade_required` 가 나와 한 시간 동안 오판한다(설정 마법사가 남긴 캐시가 이 모양).
 */
async function gatePlugin(
  resource: typeof gatewayResources.$inferSelect,
  ownerToken: string,
): Promise<PluginGate> {
  const cached = resolvePluginStatusFromCache({
    pluginStatus: resource.pluginStatus,
    pluginCheckedAt: resource.pluginCheckedAt,
    now: new Date(),
  });

  const cachedInfo = restorePluginInfo(resource.pluginInfoJson);
  const cacheUsable =
    !cached.needsReprobe &&
    cached.status !== "unknown" &&
    !(cached.status === "plugin_ready" && cachedInfo === null);

  let status: PluginStatus;
  let info: PluginInfo | null;
  if (cacheUsable) {
    status = cached.status;
    info = cachedInfo;
  } else {
    const probe = await probeDeskrpgPluginWithInfo({
      fetchImpl: transportFetch,
      baseUrl: resource.baseUrl,
      token: ownerToken,
    });
    status = probe.capability.status;
    info = probe.info;
    await db
      .update(gatewayResources)
      .set({ ...buildPluginCacheUpdate(probe.capability), ...buildPluginInfoCacheUpdate(info) })
      .where(eq(gatewayResources.id, resource.id));
  }

  if (status !== "plugin_ready") {
    const code = status === "unknown" ? "plugin_unknown" : status;
    return { ok: false, status, code, reason: `deskrpg plugin probe: ${status}` };
  }

  const verdict = meetsAutomationContract(info);
  if (!verdict.ok) {
    const missing = verdict.missing ? ` (missing: ${verdict.missing.join(", ")})` : "";
    return {
      ok: false,
      status,
      code: "plugin_upgrade_required",
      reason: `${verdict.reason}: plugin >= ${verdict.minVersion} required${missing}`,
    };
  }
  // verdict.ok 이면 info 는 null 이 아니다(`no_info` 가 먼저 걸린다).
  return { ok: true, status, info: info as PluginInfo };
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
  const pluginGate = await gatePlugin(binding.resource, ownerToken);
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
 */
export async function ensureChannelBoard(channelId: string): Promise<ChannelBoardResult> {
  try {
    const resolved = await resolveChannelBoard(channelId);
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
 * `board_name_synced_at` 은 건드리지 않는다 — 다음 폴링이 그 시각을 보고 재시도한다.
 */
export async function syncBoardName(channelId: string, name: string): Promise<ChannelBoardResult> {
  try {
    const existing = await getChannelBoard(channelId);
    if (!existing) {
      return { ok: false, code: "no_board", reason: "channel has no board row", row: null };
    }

    const resolved = await resolveChannelBoard(channelId);
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
