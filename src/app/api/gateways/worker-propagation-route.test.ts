import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// "설정에서 켜기"(게이트웨이 화면)의 진입점 — 워커 전파 운영자 설정을 호스트에 쓴다.
// 호스트에서 명령을 돌리는 동작이라 플러그인 갱신 라우트와 같은 문을 지난다: 로그인·같은 출처·소유자·
// 호스트 정책. 호스트 쪽 동작(설정 쓰기·적용)은 host.test.ts·worker-propagation.test.ts 가 고정한다.
const home = mkdtempSync(path.join(tmpdir(), "worker-propagation-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

function req(
  gatewayId: string,
  userId?: string,
  body: unknown = { enabled: true },
  origin = "http://localhost:3102",
) {
  return new NextRequest(
    `http://localhost:3102/api/gateways/${gatewayId}/plugin/worker-propagation`,
    {
      method: "POST",
      headers: {
        host: "localhost:3102",
        origin,
        "content-type": "application/json",
        ...(userId ? { "x-user-id": userId } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function user(role = "system_admin") {
  const { db, users } = await import("@/db");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Propagation-${randomUUID()}`,
      passwordHash: "test-only",
      systemRole: role,
    })
    .returning();
  return row.id;
}

async function gateway(ownerUserId: string, baseUrl: string) {
  const { upsertOwnedGatewayResource } = await import("@/lib/gateway-resources");
  return upsertOwnedGatewayResource({
    ownerUserId,
    baseUrl,
    token: "token-for-tests-0123456789",
    displayName: "전파 테스트",
  });
}

test("비로그인은 401, 다른 출처의 요청은 403 이다", async () => {
  const { POST } = await import("./[id]/plugin/worker-propagation/route");
  const owner = await user();
  const row = await gateway(owner, "http://127.0.0.1:18742");
  assert.equal((await POST(req(row.id), params(row.id))).status, 401);
  const cross = await POST(
    req(row.id, owner, { enabled: true }, "https://evil.example.com"),
    params(row.id),
  );
  assert.equal(cross.status, 403);
  assert.equal((await cross.json()).errorCode, "setup_bad_origin");
});

test("enabled 가 불리언이 아니면 호스트에 닿기 전에 400 이다", async () => {
  const { POST } = await import("./[id]/plugin/worker-propagation/route");
  const owner = await user();
  const row = await gateway(owner, "http://127.0.0.1:18743");
  for (const body of [{}, { enabled: "true" }, { enabled: 1 }, "not json"]) {
    const res = await POST(req(row.id, owner, body), params(row.id));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).errorCode, "setup_invalid_request");
  }
});

test("남의 게이트웨이는 404 다 — 공유받았어도 호스트 설정을 바꿀 수 없다", async () => {
  const { POST } = await import("./[id]/plugin/worker-propagation/route");
  const owner = await user();
  const other = await user();
  const row = await gateway(owner, "http://127.0.0.1:18744");
  const res = await POST(req(row.id, other), params(row.id));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).errorCode, "setup_not_found");
});

test("명령을 돌릴 수 없는 호스트는 이유를 말한다 — 화면은 명령 복사로 떨어진다", async () => {
  process.env.DESKRPG_HOST_SETUP_ENABLED = "1";
  const { POST } = await import("./[id]/plugin/worker-propagation/route");
  const owner = await user();
  const row = await gateway(owner, "http://host.docker.internal:8642");
  const res = await POST(req(row.id, owner), params(row.id));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errorCode, "plugin_update_unsupported_host");
});

test("관리자가 아니거나 운영자가 호스트 설정을 꺼 두면 막힌다", async () => {
  const { POST } = await import("./[id]/plugin/worker-propagation/route");
  const ordinary = await user("user");
  const ordinaryRow = await gateway(ordinary, "http://127.0.0.1:18745");
  const ordinaryRes = await POST(req(ordinaryRow.id, ordinary), params(ordinaryRow.id));
  assert.equal(ordinaryRes.status, 403);
  assert.equal((await ordinaryRes.json()).errorCode, "setup_forbidden");

  process.env.DESKRPG_HOST_SETUP_ENABLED = "0";
  try {
    const owner = await user();
    const row = await gateway(owner, "http://127.0.0.1:18746");
    const res = await POST(req(row.id, owner), params(row.id));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).errorCode, "setup_forbidden");
  } finally {
    delete process.env.DESKRPG_HOST_SETUP_ENABLED;
  }
});
