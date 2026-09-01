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

import type { PluginCapability } from "./plugin-capability";

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
