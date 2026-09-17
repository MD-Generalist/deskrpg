import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { encryptGatewayToken, listAccessibleGatewayResources } from "./gateway-resources";

// DB-backed, 같은 패턴을 이 레포의 다른 파일들과 공유한다(hermes-profiles.test.ts 등).
const sqlitePath = path.join(os.tmpdir(), `gateway-resources-test-${crypto.randomUUID()}.db`);
process.env.DESKRPG_HOME = os.tmpdir();
process.env.SQLITE_PATH = sqlitePath;
for (const ext of ["", "-wal", "-shm"]) {
  process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
}

async function loadDb() {
  return import("@/db");
}

// `nowForDb()`(src/db/index.ts) 와 같은 이유 — PG 는 timestamp(withTimezone) 컬럼에
// Date 를, SQLite 는 text 컬럼에 ISO 문자열을 기대한다. 임의 시각을 넣을 때도 같은
// 방언 분기가 필요하다.
async function dbTimestamp(d: Date): Promise<Date> {
  const { isPostgres } = await loadDb();
  return (isPostgres ? d : d.toISOString()) as unknown as Date;
}

async function seedUser(nickname: string) {
  const { db, users } = await loadDb();
  const [user] = await db
    .insert(users)
    .values({
      loginId: `${nickname}-${crypto.randomUUID().slice(0, 8)}`,
      nickname: `${nickname}-${crypto.randomUUID().slice(0, 8)}`,
      passwordHash: "hash",
    })
    .returning();
  return user;
}

// 최종 리뷰 I-1: Task 4 가 만든 pluginStatus/pluginVersion/pluginCheckedAt 캐시 컬럼을
// listAccessibleGatewayResources 가 실제로 내려주는지 고정한다. 이 배선이 없으면
// HermesProfileList(UI 레이어, 렌더 테스트 없음)가 캐시를 읽을 방법 자체가 없어
// 화면 진입마다 무조건 /test 를 다시 쳤다 — 그 회귀가 도달할 수 있는 가장 아래
// 지점(데이터 레이어)에서 이 테스트가 막는다.
describe("listAccessibleGatewayResources — 플러그인 캐시 컬럼 (최종 리뷰 I-1)", () => {
  test("소유한 게이트웨이의 pluginStatus/pluginVersion/pluginCheckedAt 을 그대로 내려준다", async () => {
    const owner = await seedUser("owner");
    const { db, gatewayResources } = await loadDb();
    const checkedAt = new Date("2026-08-31T23:50:00Z");
    await db.insert(gatewayResources).values({
      ownerUserId: owner.id,
      displayName: "Cached Gateway",
      baseUrl: "http://gw.test",
      tokenEncrypted: encryptGatewayToken("gateway-key-1234567890"),
      pluginStatus: "plugin_ready",
      pluginVersion: "0.3.0",
      pluginCheckedAt: await dbTimestamp(checkedAt),
    });

    const rows = await listAccessibleGatewayResources(owner.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pluginStatus, "plugin_ready");
    assert.equal(rows[0].pluginVersion, "0.3.0");
    assert.ok(rows[0].pluginCheckedAt, "pluginCheckedAt 이 내려와야 캐시 신선도를 판정할 수 있다");
  });

  test("캐시가 아직 없는 게이트웨이는 null 을 그대로 내려준다(가짜 신선도로 접지 않는다)", async () => {
    const owner = await seedUser("owner2");
    const { db, gatewayResources } = await loadDb();
    await db.insert(gatewayResources).values({
      ownerUserId: owner.id,
      displayName: "Fresh Gateway",
      baseUrl: "http://gw2.test",
      tokenEncrypted: encryptGatewayToken("gateway-key-0987654321"),
    });

    const rows = await listAccessibleGatewayResources(owner.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pluginStatus, null);
    assert.equal(rows[0].pluginCheckedAt, null);
  });

  test("공유받은 게이트웨이도 같은 캐시 필드를 내려준다", async () => {
    const owner = await seedUser("owner3");
    const sharedUser = await seedUser("shared3");
    const { db, gatewayResources, gatewayShares } = await loadDb();
    const [gateway] = await db
      .insert(gatewayResources)
      .values({
        ownerUserId: owner.id,
        displayName: "Shared Gateway",
        baseUrl: "http://gw3.test",
        tokenEncrypted: encryptGatewayToken("gateway-key-1122334455"),
        pluginStatus: "plugin_absent",
        pluginCheckedAt: await dbTimestamp(new Date()),
      })
      .returning();
    await db
      .insert(gatewayShares)
      .values({ gatewayId: gateway.id, userId: sharedUser.id, role: "use" });

    const rows = await listAccessibleGatewayResources(sharedUser.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pluginStatus, "plugin_absent");
    assert.equal(rows[0].isOwner, false);
  });
});

describe("listAccessibleGatewayResources — Hermes 대시보드 주소", () => {
  const info = (dashboardUrl: string | null) =>
    JSON.stringify({
      plugin: "deskrpg",
      version: "0.7.1",
      capabilities: ["kanban", "cron", "events"],
      timezone: "Asia/Seoul",
      kanban: { dispatcher_present: true, attachments: true },
      dashboard_url: dashboardUrl,
    });

  test("소유자에게는 캐시된 플러그인 정보의 대시보드 주소를 내려준다", async () => {
    const owner = await seedUser("dash-owner");
    const { db, gatewayResources } = await loadDb();
    await db.insert(gatewayResources).values({
      ownerUserId: owner.id,
      displayName: "Dashboard Gateway",
      baseUrl: "http://hermes:8642",
      tokenEncrypted: encryptGatewayToken("gateway-key-dash-000001"),
      pluginStatus: "plugin_ready",
      pluginInfoJson: info("https://deskrpg-hermes.srv1.hstgr.cloud"),
    });
    const rows = await listAccessibleGatewayResources(owner.id);
    assert.equal(rows[0].dashboardUrl, "https://deskrpg-hermes.srv1.hstgr.cloud");
  });

  test("캐시가 없거나 주소가 없으면 null", async () => {
    const owner = await seedUser("dash-none");
    const { db, gatewayResources } = await loadDb();
    await db.insert(gatewayResources).values({
      ownerUserId: owner.id,
      displayName: "No Dashboard",
      baseUrl: "http://gw-nodash.test",
      tokenEncrypted: encryptGatewayToken("gateway-key-dash-000002"),
    });
    const rows = await listAccessibleGatewayResources(owner.id);
    assert.equal(rows[0].dashboardUrl, null);
  });

  test("공유받은 사용자에게는 대시보드 주소를 내려주지 않는다 — Hermes 전체를 다루는 관리 화면이다", async () => {
    const owner = await seedUser("dash-owner2");
    const sharedUser = await seedUser("dash-shared");
    const { db, gatewayResources, gatewayShares } = await loadDb();
    const [gateway] = await db
      .insert(gatewayResources)
      .values({
        ownerUserId: owner.id,
        displayName: "Shared Dashboard Gateway",
        baseUrl: "http://gw-shared-dash.test",
        tokenEncrypted: encryptGatewayToken("gateway-key-dash-000003"),
        pluginStatus: "plugin_ready",
        pluginInfoJson: info("https://deskrpg-hermes.srv2.hstgr.cloud"),
      })
      .returning();
    await db
      .insert(gatewayShares)
      .values({ gatewayId: gateway.id, userId: sharedUser.id, role: "use" });
    const rows = await listAccessibleGatewayResources(sharedUser.id);
    assert.equal(rows[0].dashboardUrl, null);
  });
});
