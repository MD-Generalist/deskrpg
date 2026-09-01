import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { gatewayResources } from "./schema-sqlite";

describe("gateway_resources 플러그인 능력 캐시", () => {
  it("Drizzle 스키마에 컬럼 3개가 있다", () => {
    assert.ok(gatewayResources.pluginStatus);
    assert.ok(gatewayResources.pluginVersion);
    assert.ok(gatewayResources.pluginCheckedAt);
  });

  it("빈 DB 부트스트랩 SQL 에도 같은 컬럼이 있다", () => {
    // schema-sqlite.ts 는 빈 런타임 DB 를 마이그레이션하지 않는다(CLAUDE.md).
    // 여기가 어긋나면 새로 설치한 사용자에게서만 깨진다 — 개발 DB 에서는 안 보인다.
    const sql = readFileSync(new URL("./sqlite-base-schema.js", import.meta.url), "utf8");
    const table = /CREATE TABLE IF NOT EXISTS gateway_resources[\s\S]*?\);/.exec(sql);
    assert.ok(table, "gateway_resources CREATE TABLE 을 찾지 못했다");
    assert.match(table[0], /plugin_status/);
    assert.match(table[0], /plugin_version/);
    assert.match(table[0], /plugin_checked_at/);
  });
});
