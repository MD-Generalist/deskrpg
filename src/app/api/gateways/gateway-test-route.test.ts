import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Task 9 라운드 2 회귀 방어.
//
// 라운드 1 은 `buildPluginCacheUpdate` 를 순수 함수로 뽑아 `nowForDb()` 의 방언별
// 출력(Date/문자열)이 그 함수를 그대로 통과한다는 것만 고정했다. 그런데 그 테스트는
// `buildPluginCacheUpdate` 를 직접 부를 뿐 `src/app/api/gateways/[id]/test/route.ts` 의
// POST 핸들러를 한 번도 실행하지 않는다 — 라우트 호출부를
// `buildPluginCacheUpdate(plugin, new Date().toISOString() as unknown as Date)` 로
// 바꿔도(=nowForDb() 를 완전히 안 쓰는 경우) 911 개가 그대로 통과했다(팀리드 실측).
//
// 이 파일이 그 구멍을 닫는다 — plugin-proxy-route.test.ts 와 같은 두 가지 수법을
// 조합한다:
//   1. 실제 route.ts 의 POST 를 로컬 스텁 Hermes 서버(/health·/v1/models·/deskrpg/info)
//      로 실행해, `db.update(gatewayResources)` 가 실제로 일어나고 저장된 값이 방금
//      막 만들어진 타임스탬프인지 확인한다(라우트가 쓰기 경로를 실제로 타는지).
//   2. 다만 이 프로세스는 SQLite 방언으로만 실행되고, SQLite 에서는
//      `nowForDb()` 도 `new Date().toISOString()` 도 똑같이 문자열을 낸다 — 값만 보고는
//      두 호출을 구분할 수 없다(팀리드가 지적한 지점). 그래서 소스 핀 테스트를
//      더한다: 라우트의 쓰기 호출이 정확히 `nowForDb()` 를 넘기는지 텍스트로 고정한다.
//      round-1 의 `buildPluginCacheUpdate` 방언 테스트(값이 Date 인지/문자열인지)와
//      합치면 "라우트가 nowForDb() 를 쓴다" + "nowForDb() 는 방언대로 낸다" 둘 다 잠긴다.
//
// 최상위 경로(`[id]` 세그먼트 밖)에 둔다 — plugin-proxy-route.test.ts 와 같은 이유:
// node 테스트 러너가 `[id]` 를 문자 클래스로 오인해 그 안의 *.test.ts 를 못 줍는다.

const sqlitePath = path.join(os.tmpdir(), `gateway-test-route-test-${crypto.randomUUID()}.db`);
process.env.DESKRPG_HOME = os.tmpdir();
process.env.SQLITE_PATH = sqlitePath;
for (const ext of ["", "-wal", "-shm"]) {
  process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
}

async function loadDb() {
  return import("@/db");
}

async function seedUser() {
  const { db, users } = await loadDb();
  const [user] = await db
    .insert(users)
    .values({
      loginId: `u-${crypto.randomUUID().slice(0, 8)}`,
      nickname: `u-${crypto.randomUUID().slice(0, 8)}`,
      passwordHash: "hash",
    })
    .returning();
  return user;
}

async function seedGateway(ownerId: string, baseUrl: string) {
  const { db, gatewayResources } = await loadDb();
  const { encryptGatewayToken } = await import("@/lib/gateway-resources");
  const [gateway] = await db
    .insert(gatewayResources)
    .values({
      ownerUserId: ownerId,
      displayName: "Test Gateway",
      baseUrl,
      tokenEncrypted: encryptGatewayToken("gateway-default-key-1234567890"),
    })
    .returning();
  return gateway;
}

function postReq(url: string, userId: string): NextRequest {
  return new NextRequest(url, { method: "POST", headers: { "x-user-id": userId } });
}

// probeHermesGateway 가 API Server 로 판정하려면 /health 는 2xx, /v1/models 는
// content-type 이 JSON 이어야 한다(gateway-probe.ts 주석 참조 — 대시보드는
// text/html 을 낸다). 그 뒤 probeDeskrpgPlugin 이 /deskrpg/info 를 찌른다.
function startStubHermesServer(pluginVersion: string) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (req.url === "/deskrpg/info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ plugin: "deskrpg", version: pluginVersion }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  return server;
}

describe("게이트웨이 테스트 라우트 — 플러그인 캐시를 실제로 쓴다 (Task 9 라운드 2)", () => {
  test("Hermes 로 판정되면 POST 가 gatewayResources 의 plugin_* 컬럼을 방금 만든 값으로 갱신한다", async () => {
    const server = startStubHermesServer("0.4.2");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const owner = await seedUser();
      const gateway = await seedGateway(owner.id, baseUrl);
      const beforeCall = Date.now();

      const { POST } = await import("./[id]/test/route");
      const res = await POST(
        postReq(`http://localhost/api/gateways/${gateway.id}/test`, owner.id),
        {
          params: Promise.resolve({ id: gateway.id }),
        },
      );
      const afterCall = Date.now();

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.deepEqual(body.plugin, { status: "plugin_ready", version: "0.4.2" });

      const { db, gatewayResources } = await loadDb();
      const { eq } = await import("drizzle-orm");
      const [row] = await db
        .select()
        .from(gatewayResources)
        .where(eq(gatewayResources.id, gateway.id));

      assert.equal(row.pluginStatus, "plugin_ready");
      assert.equal(row.pluginVersion, "0.4.2");
      // SQLite 방언에서는 nowForDb() 도 새 Date().toISOString() 도 값만 보면
      // 구분되지 않는다 — 그래서 여기서는 "실제로 쓰기가 일어났고 값이 방금 만든
      // 시각"이라는 것만 확인한다. "정말 nowForDb() 를 호출했는가"는 아래 소스 핀
      // 테스트가 잠근다.
      assert.equal(typeof row.pluginCheckedAt, "string");
      const checkedAtMs = Date.parse(row.pluginCheckedAt as unknown as string);
      assert.ok(
        checkedAtMs >= beforeCall && checkedAtMs <= afterCall,
        `plugin_checked_at 이 호출 구간 안의 시각이어야 한다 (${row.pluginCheckedAt})`,
      );
    } finally {
      server.close();
    }
  });
});

describe("게이트웨이 테스트 라우트 — 쓰기 호출이 nowForDb() 를 쓴다는 걸 소스에 고정한다 (Task 9 라운드 2)", () => {
  test("db.update(gatewayResources).set(buildPluginCacheUpdate(plugin, nowForDb())) 그대로", () => {
    // 값-타입 테스트만으로는 SQLite 방언에서 nowForDb() 와
    // new Date().toISOString() 를 구분할 수 없다(둘 다 문자열). 이 라우트 호출부가
    // 문자열 리터럴을 직접 만들지 않고 반드시 nowForDb() 를 통해서만 시각을 얻는다는
    // 걸 소스 텍스트로 고정한다 — 팀리드가 실증한 정확한 변이(nowForDb() 호출을
    // `new Date().toISOString() as unknown as Date` 로 바꾸는 것)를 잡는다.
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/gateways/[id]/test/route.ts"),
      "utf8",
    );
    assert.match(
      src,
      /\.set\(buildPluginCacheUpdate\(plugin,\s*nowForDb\(\)\)\)/,
      "게이트웨이 테스트 라우트의 쓰기 호출이 nowForDb() 를 쓰지 않습니다 — " +
        "PostgreSQL 에서 timestamp 컬럼에 문자열이 잘못 바인딩됩니다.",
    );
  });
});
