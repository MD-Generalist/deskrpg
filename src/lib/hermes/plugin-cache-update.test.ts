import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import type { PluginCapability } from "./plugin-capability";
import type { buildPluginCacheUpdate as BuildPluginCacheUpdateFn } from "./plugin-cache-update";

const require = createRequire(import.meta.url);

// PostgreSQL: `timestamp(withTimezone)` 컬럼은 date 모드라 드라이버가 `Date` 를 기대한다.
// SQLite: `text` 컬럼은 문자열을 기대한다. `buildPluginCacheUpdate()` 는 이제 스스로
// `nowForDb()` 를 부르므로(호출자가 값을 주입할 자리가 없다 — Task 9 라운드 3), 그
// 방언 분기를 관찰하려면 `nowForDb()` 가 캡처된 시점의 `src/db/index.ts` 자체를
// 다시 읽어야 한다. `isPostgres` 는 그 모듈 로드 시점의 상수라
// (task-manager-timestamps.test.ts 와 같은 사고), require 캐시를 지우고 환경변수를
// 바꿔 같은 프로세스 안에서 `db/index.ts` 와 `plugin-cache-update.ts` 를 함께
// 다시 읽는다 — plugin-cache-update.ts 의 `import { nowForDb } from "@/db"` 가 새로
// 읽힌 db/index.ts 를 다시 가리키게 하기 위해서다.
function loadBuildPluginCacheUpdate(env: {
  DB_TYPE: string;
  DATABASE_URL?: string;
}): typeof BuildPluginCacheUpdateFn {
  const prevDbType = process.env.DB_TYPE;
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DB_TYPE = env.DB_TYPE;
  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  else delete process.env.DATABASE_URL;

  const dbModulePath = require.resolve("../../db/index.ts");
  const pluginCacheUpdateModulePath = require.resolve("./plugin-cache-update.ts");
  delete require.cache[dbModulePath];
  delete require.cache[pluginCacheUpdateModulePath];
  const { buildPluginCacheUpdate } = require("./plugin-cache-update.ts") as {
    buildPluginCacheUpdate: typeof BuildPluginCacheUpdateFn;
  };

  if (prevDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = prevDbType;
  if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDatabaseUrl;

  return buildPluginCacheUpdate;
}

// 판정 D·F 회귀 방어: 게이트웨이 테스트 라우트가 db.update(...).set(...) 에 넘길 payload 의
// 값 TYPE 을 방언별로 고정한다. `nowForDb()` 를 `new Date().toISOString()` 으로 되돌리면
// PG 방언 케이스가 실패해야 한다 — 실제로 되돌려 확인함(task-9-report.md 참조).
//
// 최종 리뷰 I-1 후속: `plugin-capability.test.ts` 에서 이 파일로 옮겼다 —
// `buildPluginCacheUpdate` 자체가 `plugin-capability.ts` 에서 `plugin-cache-update.ts`
// (서버 전용)로 옮겨졌기 때문이다(그 파일이 클라이언트 컴포넌트에서 직접 import 되며
// `@/db` 를 더는 담을 수 없게 됐다 — 모듈 헤더 주석 참조).
describe("buildPluginCacheUpdate", () => {
  const plugin: PluginCapability = { status: "plugin_ready", version: "0.3.0" };

  it("PostgreSQL 방언: 스스로 부른 nowForDb() 가 Date 를 낸다", () => {
    const buildPluginCacheUpdate = loadBuildPluginCacheUpdate({
      DB_TYPE: "postgresql",
      DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    });

    const payload = buildPluginCacheUpdate(plugin);
    assert.ok(payload.pluginCheckedAt instanceof Date, "PG 방언에서는 Date 여야 한다");
    assert.ok(payload.updatedAt instanceof Date);
  });

  it("SQLite 방언: 스스로 부른 nowForDb() 가 ISO 문자열을 낸다", () => {
    const buildPluginCacheUpdate = loadBuildPluginCacheUpdate({ DB_TYPE: "sqlite" });

    const payload = buildPluginCacheUpdate(plugin);
    assert.equal(typeof payload.pluginCheckedAt, "string", "SQLite 방언에서는 문자열이어야 한다");
    assert.equal(typeof payload.updatedAt, "string");
  });
});

// 자동화 계약 블록(`/deskrpg/info` 의 capabilities·timezone·kanban)은
// `gateway_resources.plugin_info_json`(텍스트 컬럼, 병행 태스크가 추가) 에 JSON 문자열로
// 보관한다. 컬럼이 이 워크트리에 아직 없으므로 helper 는 문자열만 주고받는다 — 컬럼이
// 생기면 라우트가 `{ pluginInfoJson }` 을 `.set()` 에 합치면 된다.
describe("plugin_info_json 직렬화", () => {
  it("info 가 있으면 JSON 문자열, 없으면 null 을 pluginInfoJson 에 싣는다", async () => {
    const { buildPluginInfoCacheUpdate, restorePluginInfo } = await import("./plugin-cache-update");
    const info = {
      plugin: "deskrpg" as const,
      version: "0.7.1",
      capabilities: ["kanban", "cron", "events"],
      timezone: "Asia/Seoul",
      kanban: { dispatcher_present: true, attachments: false },
      // 게이트웨이 목록이 이 캐시에서 대시보드 주소를 꺼낸다 — 왕복에서 빠지면 버튼이 사라진다.
      dashboard_url: "https://deskrpg-hermes.srv1.hstgr.cloud",
    };
    const payload = buildPluginInfoCacheUpdate(info);
    assert.equal(typeof payload.pluginInfoJson, "string");
    assert.deepEqual(restorePluginInfo(payload.pluginInfoJson), info);

    const absent = buildPluginInfoCacheUpdate(null);
    assert.equal(absent.pluginInfoJson, null);
  });

  it("restorePluginInfo 는 깨진 JSON·낯선 모양을 null 로 접는다", async () => {
    const { restorePluginInfo } = await import("./plugin-cache-update");
    assert.equal(restorePluginInfo(null), null);
    assert.equal(restorePluginInfo("{not json"), null);
    assert.equal(restorePluginInfo(JSON.stringify({ hello: "world" })), null);
  });
});
