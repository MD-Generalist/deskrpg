import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { getTableColumns } from "drizzle-orm";

import { gatewayResources } from "./schema-sqlite";
import { gatewayResources as gatewayResourcesPg } from "./schema";

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

  it("PostgreSQL 스키마(schema.ts)에도 컬럼 3개가 있다 — 방언 간 가드", () => {
    // schema-drift.test.ts 는 같은 방언 안(schema.ts↔schema.pg.cjs,
    // schema-sqlite.ts↔schema.sqlite.cjs)만 대조하고 SQLite↔PostgreSQL 은 비교하지
    // 않는다. 그래서 SQLite 쪽에만 컬럼을 추가해도 drift 테스트는 전부 초록으로
    // 통과한다 — 실제로 이 컬럼들을 처음 추가했을 때 PostgreSQL 쪽이 통째로 빠진 채
    // 그렇게 통과했다. 스테이징(stage.deskrpg.com)은 PostgreSQL 이므로 이 가드가 없으면
    // 런타임에서만 "no such column" 이 난다. tasks 테이블의 2026-04 회귀 가드
    // (schema-drift.test.ts) 와 같은 형태.
    const cols = new Set(Object.keys(getTableColumns(gatewayResourcesPg)));
    for (const required of ["pluginStatus", "pluginVersion", "pluginCheckedAt"]) {
      assert.ok(cols.has(required), `gatewayResources(PostgreSQL).${required} 가 없다`);
    }
  });
});
