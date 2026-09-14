/**
 * `gatewayResources.pluginStatus/pluginVersion/pluginCheckedAt` 캐시에 쓸 payload 조립.
 *
 * `plugin-capability.ts` 에서 분리했다 — 그 파일은 `HermesProfileList.tsx`(클라이언트
 * 컴포넌트)가 `resolvePluginStatusFromCache` 를 쓰려고 직접 import 하므로 `@/db`
 * (그리고 그것이 끌어오는 `pg`/`better-sqlite3`)를 담으면 안 된다. 이 함수는 DB 에
 * 쓸 값을 만드는 서버 전용 로직이라 여기 남는다 — 부르는 곳도
 * `src/app/api/gateways/[id]/test/route.ts`(라우트 핸들러) 하나뿐이다.
 */

import { nowForDb } from "@/db";

import type { PluginInfo } from "./deskrpg-plugin-types";
import { parsePluginInfo, type PluginCapability } from "./plugin-capability";

/**
 * 게이트웨이 테스트 라우트가 `db.update(gatewayResources).set(...)` 에 넘길 payload 를
 * 만든다. 타임스탬프를 **스스로** `nowForDb()` 로 구한다 — 호출자에게 맡기면 호출부가
 * `new Date().toISOString()` 같은 방언-무관 값을 대신 넘길 수 있고, PostgreSQL 에서는
 * `Date` 를 기대하는 `timestamp(withTimezone)` 컬럼에 문자열이 잘못 바인딩된다
 * (판정 D 사고). 잘못된 타입을 넘길 자리 자체를 없애는 것이 이 함수의 계약이다.
 */
export function buildPluginCacheUpdate(plugin: PluginCapability) {
  const now = nowForDb();
  return {
    pluginStatus: plugin.status,
    pluginVersion: plugin.version,
    pluginCheckedAt: now,
    updatedAt: now,
  };
}

/**
 * 자동화 계약 블록(`/deskrpg/info` 의 capabilities·timezone·kanban)을
 * `gateway_resources.plugin_info_json`(텍스트 컬럼) 에 넣을 payload.
 *
 * `buildPluginCacheUpdate` 와 합치지 않고 따로 둔 이유: 그 컬럼은 병행 태스크가
 * 추가하는 중이라 이 워크트리의 drizzle 스키마에 아직 없다. 두 payload 를 한 객체로
 * 내보내면 `.set()` 이 컬럼 없는 키를 받아 타입 검사에 실패한다. 컬럼이 생기면
 * 라우트에서 `{ ...buildPluginCacheUpdate(p), ...buildPluginInfoCacheUpdate(p) }` 로
 * 합치면 된다 — 이 함수는 문자열(또는 null)만 낸다.
 */
export function buildPluginInfoCacheUpdate(info: PluginInfo | null): {
  pluginInfoJson: string | null;
} {
  return { pluginInfoJson: info ? JSON.stringify(info) : null };
}

/**
 * `plugin_info_json` 컬럼 값을 `PluginInfo` 로 되돌린다. 깨진 JSON·낯선 모양은 null —
 * 캐시가 못 읽히면 재프로브하면 되지, 던져서 화면을 막을 일이 아니다.
 */
export function restorePluginInfo(json: string | null | undefined): PluginInfo | null {
  if (!json) return null;
  try {
    return parsePluginInfo(JSON.parse(json));
  } catch {
    return null;
  }
}
