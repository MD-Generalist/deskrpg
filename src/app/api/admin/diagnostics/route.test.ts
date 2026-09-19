import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "diagnostics-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const url = "http://localhost:3102/api/admin/diagnostics";
const req = (userId?: string) =>
  new NextRequest(url, {
    headers: { host: "localhost:3102", ...(userId ? { "x-user-id": userId } : {}) },
  });

async function user(role: string) {
  const { db, users } = await import("@/db");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Diag-${randomUUID()}`,
      passwordHash: "test-only",
      systemRole: role,
    })
    .returning();
  return row.id;
}

test("비관리자와 익명 요청은 403 이 아니라 404 를 받는다", async () => {
  const { GET } = await import("./route");
  assert.equal((await GET(req())).status, 404);
  const ordinary = await user("user");
  const denied = await GET(req(ordinary));
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).errorCode, "not_found");
  // 존재하지 않는 사용자 id 를 헤더로 밀어 넣어도 같은 404 다.
  assert.equal((await GET(req(randomUUID()))).status, 404);
});

test("관리자는 환경·DB·호스트 설정·게이트웨이 항목을 받는다", async () => {
  const { GET } = await import("./route");
  const admin = await user("system_admin");
  const { db, gatewayResources } = await import("@/db");
  const [gateway] = await db
    .insert(gatewayResources)
    .values({
      ownerUserId: admin,
      displayName: "진단용 게이트웨이",
      baseUrl: "http://127.0.0.1:8642",
      tokenEncrypted: "diagnostics-secret-token-value",
      pluginStatus: "ready",
    })
    .returning();

  const res = await GET(req(admin));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.environment.errors));
  assert.ok(Array.isArray(body.environment.warnings));
  assert.equal(body.environment.dbTarget, "sqlite");
  assert.equal(typeof body.database.ok, "boolean");
  assert.equal(typeof body.database.message, "string");
  // 2026-09-19 부터 기본은 관리자에게 켜짐이다 — 운영자가 0 으로 끄지 않은 한 둘 다 true.
  assert.deepEqual(body.hostSetup, { wizard: true, hermesInstall: true });
  const row = body.gateways.find((entry: { id: string }) => entry.id === gateway.id);
  assert.ok(row, "등록한 게이트웨이가 목록에 있어야 한다");
  assert.equal(row.label, "진단용 게이트웨이");
  assert.equal(row.pluginStatus, "ready");
  assert.equal(row.checkedAt, null);
});

test("응답 본문에 게이트웨이 토큰·baseUrl 문자열이 실리지 않는다", async () => {
  const { GET } = await import("./route");
  const admin = await user("system_admin");
  const { db, gatewayResources } = await import("@/db");
  await db.insert(gatewayResources).values({
    ownerUserId: admin,
    displayName: "토큰 보관 게이트웨이",
    baseUrl: "http://10.7.7.7:8642",
    tokenEncrypted: "super-secret-token-must-not-leak",
    pluginStatus: "ready",
  });
  const text = await (await GET(req(admin))).text();
  assert.equal(text.includes("super-secret-token-must-not-leak"), false);
  assert.equal(text.includes("10.7.7.7"), false);
  assert.equal(text.includes("tokenEncrypted"), false);
});

test("DB 가 닿지 않아도 200 으로 진단을 돌려준다", async () => {
  const { GET } = await import("./route");
  const admin = await user("system_admin");
  const original = process.env.SQLITE_PATH;
  // 존재하지도, 만들 수도 없는 경로 — 프로브는 실패하지만 진단은 계속돼야 한다.
  process.env.SQLITE_PATH = "/deskrpg-does-not-exist-root/data/deskrpg.db";
  try {
    const res = await GET(req(admin));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.database.ok, false);
    assert.ok(body.database.message.length > 0);
    assert.ok(Array.isArray(body.gateways));
  } finally {
    process.env.SQLITE_PATH = original;
  }
});
