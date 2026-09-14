/**
 * 자동화 플러그인 게이트 — **단 하나의** 판정 함수.
 *
 * 칸반(보드 확보·폴러)과 크론 REST 가 같은 판정을 써야 한다. 예전에는 두 벌이 있었고
 * 크론 쪽은 신선한 `unknown`/`plugin_absent`/`plugin_unauthorized` 캐시를 그대로 믿은 뒤
 * "info 가 없다" 는 이유로 428 `plugin_upgrade_required` 를 내 오진했다. 판정은 여기서만
 * 하고, HTTP 응답으로 옮기는 일은 `cron-access.ts` 의 `pluginGateResponse` 가 한다.
 *
 * 게이트웨이의 플러그인 판정을 캐시에서 읽거나(1시간 규칙 — `shouldReprobePlugin`) 다시 찔러
 * 캐시를 채운다. 두 경우는 캐시가 신선해도 다시 찌른다 — 정보가 없는 것이지 판정이 난 것이
 * 아니기 때문이다:
 * - `unknown`(도달 실패·타임아웃) — 한 시간 붙들면 게이트웨이가 살아나도 보드 확보가 막힌다.
 * - `plugin_ready` 인데 `plugin_info_json` 이 비었음 — info 없이 계약을 판정하면 `no_info` 로
 *   `plugin_upgrade_required` 가 나와 한 시간 동안 오판한다(설정 마법사가 남긴 캐시가 이 모양).
 */

import { eq } from "drizzle-orm";

import { db, gatewayResources } from "@/db";
import type { PluginInfo } from "@/lib/hermes/deskrpg-plugin-types";
import {
  buildPluginCacheUpdate,
  buildPluginInfoCacheUpdate,
  restorePluginInfo,
} from "@/lib/hermes/plugin-cache-update";
import {
  meetsAutomationContract,
  probeDeskrpgPluginWithInfo,
  resolvePluginStatusFromCache,
  type AutomationContractVerdict,
  type PluginStatus,
} from "@/lib/hermes/plugin-capability";
import { transportFetch } from "@/lib/hermes/setup/transport";

export type GatewayResourceRow = typeof gatewayResources.$inferSelect;

/** 게이트가 내는 실패 코드. `channel_kanban_boards.last_error` 에 그대로 남는다. */
export type PluginGateFailureCode =
  "plugin_absent" | "plugin_unauthorized" | "plugin_unknown" | "plugin_upgrade_required";

/** 플러그인 계약 판정. `ok:false` 의 `code` 는 그대로 `last_error` 가 된다. */
export type PluginGate =
  | { ok: true; status: "plugin_ready"; info: PluginInfo }
  | {
      ok: false;
      status: PluginStatus;
      code: PluginGateFailureCode;
      reason: string;
      /** `plugin_unknown` 이 전송 계층 실패였으면 어느 쪽인지 — HTTP 응답의 코드가 된다. */
      transport?: "unreachable" | "timeout";
      /** `plugin_upgrade_required` 일 때 계약 판정 상세(최소 버전·이유·빠진 capability). */
      verdict?: Extract<AutomationContractVerdict, { ok: false }>;
    };

export async function gateAutomationPlugin(
  resource: GatewayResourceRow,
  ownerToken: string,
  now = new Date(),
): Promise<PluginGate> {
  const cached = resolvePluginStatusFromCache({
    pluginStatus: resource.pluginStatus,
    pluginCheckedAt: resource.pluginCheckedAt,
    now,
  });

  const cachedInfo = restorePluginInfo(resource.pluginInfoJson);
  const cacheUsable =
    !cached.needsReprobe &&
    cached.status !== "unknown" &&
    !(cached.status === "plugin_ready" && cachedInfo === null);

  let status: PluginStatus;
  let info: PluginInfo | null;
  let transport: "unreachable" | "timeout" | undefined;
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
    transport = probe.failure;
    await db
      .update(gatewayResources)
      .set({ ...buildPluginCacheUpdate(probe.capability), ...buildPluginInfoCacheUpdate(info) })
      .where(eq(gatewayResources.id, resource.id));
  }

  if (status !== "plugin_ready") {
    const code = status === "unknown" ? "plugin_unknown" : status;
    return {
      ok: false,
      status,
      code,
      reason: `deskrpg plugin probe: ${transport ?? status}`,
      ...(transport ? { transport } : {}),
    };
  }

  const verdict = meetsAutomationContract(info);
  if (!verdict.ok) {
    const missing = verdict.missing ? ` (missing: ${verdict.missing.join(", ")})` : "";
    return {
      ok: false,
      status,
      code: "plugin_upgrade_required",
      reason: `${verdict.reason}: plugin >= ${verdict.minVersion} required${missing}`,
      verdict,
    };
  }
  // verdict.ok 이면 info 는 null 이 아니다(`no_info` 가 먼저 걸린다).
  return { ok: true, status, info: info as PluginInfo };
}
