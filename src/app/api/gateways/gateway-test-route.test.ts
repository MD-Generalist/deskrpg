import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Task 9 라운드 2·3 회귀 방어.
//
// 라운드 1 은 `buildPluginCacheUpdate` 를 순수 함수로 뽑아 `nowForDb()` 의 방언별
// 출력(Date/문자열)이 그 함수를 그대로 통과한다는 것만 고정했다. 그런데 그 테스트는
// `buildPluginCacheUpdate` 를 직접 부를 뿐 `src/app/api/gateways/[id]/test/route.ts` 의
// POST 핸들러를 한 번도 실행하지 않는다 — 라우트 호출부를 바꿔치기해도 아무 테스트도
// 못 잡는 구멍이 있었다(팀리드 실측).
//
// 라운드 3 이 그 구멍을 구조적으로 닫았다: `buildPluginCacheUpdate(plugin)` 가 이제
// `now` 를 주입받지 않고 스스로 `nowForDb()` 를 부른다(plugin-capability.ts) — 그래서
// 라우트 호출부에는 애초에 틀린 값을 넘길 자리가 없고, 그 사실은 round-1 의 방언
// 테스트(plugin-capability.test.ts, require.cache 로 PG/SQLite 재평가)가 함수 몸통
// 안의 실제 `nowForDb()` 호출을 직접 관찰해 잠근다. 그 결과 여기서 소스 텍스트를
// 정규식으로 고정하던 테스트는 더 필요 없어 지웠다(포매팅이나 변수 추출로 깨지고
// 반대로 의미가 바뀌어도 통과할 수 있는 취약한 방식이었다).
//
// 이 파일에 남기는 것은 **배선 검증**이다 — 타임스탬프 타입과는 별개로, POST 핸들러가
// 실제로 실행되어 `probeHermesGateway` → `probeDeskrpgPlugin` → `db.update` 로
// 이어지는지, 응답과 DB 에 쓰인 값이 실제로 맞는지를 본다. plugin-proxy-route.test.ts
// 와 같은 수법(throwaway SQLite + 로컬 스텁 Hermes 서버)을 그대로 쓴다.
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

describe("게이트웨이 테스트 라우트 — 플러그인 캐시를 실제로 쓴다 (Task 9)", () => {
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
      // T4: 자동화 계약 블록도 같은 호출에서 캐시된다(0.6.0 이전 본문은 capabilities 가 빈 배열).
      assert.ok(row.pluginInfoJson, "plugin_info_json 이 채워져야 한다");
      assert.deepEqual(JSON.parse(row.pluginInfoJson as string).capabilities, []);
      // 화면의 "아직 테스트하지 않음" 은 last_validation_status 를 본다. 예전에는
      // 이 라우트가 plugin_* 만 쓰고 검증 상태를 비워 둬서, 연결 테스트를 아무리
      // 눌러도 목록이 그대로였다(스테이징 실측 2026-09-07). persistGatewayValidationState
      // 는 이 브랜치 이전부터 있었지만 **아무도 부르지 않는 죽은 코드**였다.
      assert.equal(row.lastValidationStatus, "valid");
      assert.equal(row.lastValidationError, null);
      assert.ok(row.lastValidatedAt, "lastValidatedAt 이 채워져야 한다");
      // SQLite 방언에서 쓰인 값이 정말 방금 만든 시각인지만 본다 — "그 값이
      // nowForDb() 에서 나왔는가"는 함수 몸통이 nowForDb() 를 스스로 부르는
      // 구조(라운드 3) + plugin-capability.test.ts 의 방언 재평가 테스트가 잠근다.
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
