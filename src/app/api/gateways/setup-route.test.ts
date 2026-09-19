import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "setup-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
const url = "http://localhost:3102/api/gateways/setup";
function req(userId?: string, body?: unknown, origin = "http://localhost:3102") {
  return new NextRequest(url, {
    method: body ? "POST" : "GET",
    headers: {
      host: "localhost:3102",
      origin,
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function user(role: string) {
  const { db, users } = await import("@/db");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Setup-${randomUUID()}`,
      passwordHash: "test-only",
      systemRole: role,
    })
    .returning();
  return row.id;
}
test("actual setup route rejects anonymous, ordinary user and disabled operator before discovery", async () => {
  const { GET, POST } = await import("./setup/route");
  assert.equal((await GET(req())).status, 401);
  const ordinary = await user("user"),
    admin = await user("system_admin");
  process.env.DESKRPG_HOST_SETUP_ENABLED = "1";
  const denied = await POST(req(ordinary, { action: "discover", mode: "local" }));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).errorCode, "setup_forbidden");
  // 2026-09-19 부터 관리자는 기본 허용이다 — 운영자가 0 으로 끈 경우만 거절한다.
  process.env.DESKRPG_HOST_SETUP_ENABLED = "0";
  assert.equal((await POST(req(admin, { action: "discover", mode: "local" }))).status, 403);
  const cap = await (await GET(req(admin))).json();
  assert.equal(cap.local, false);
  assert.equal(cap.localReason, "disabled");
  assert.equal(cap.hostLabel, "");
  assert.deepEqual(cap.sshHosts, []);
  delete process.env.DESKRPG_HOST_SETUP_ENABLED;
});
test("actual mutation route requires same origin even for administrator", async () => {
  const { POST } = await import("./setup/route");
  const admin = await user("system_admin");
  const result = await POST(
    req(admin, { action: "discover", mode: "local" }, "https://evil.example"),
  );
  assert.equal(result.status, 403);
  assert.equal((await result.json()).errorCode, "setup_bad_origin");
});
test("job progress and cancellation cannot be accessed by another user", async () => {
  const { GET, POST } = await import("./setup/route");
  const { SetupJobStore } = await import("@/lib/hermes/setup/store");
  const owner = await user("system_admin"),
    stranger = await user("system_admin");
  const jobs = new SetupJobStore(),
    job = jobs.create(owner);
  const read = await GET(
    new NextRequest(`${url}?job=${job.id}`, { headers: { "x-user-id": stranger } }),
  );
  assert.equal(read.status, 404);
  assert.equal((await POST(req(stranger, { action: "cancel", jobId: job.id }))).status, 404);
  assert.equal(jobs.cancelled(owner, job.id), false);
});
test("잘못된 시간대는 호스트를 건드리기 전에 400 으로 거부된다", async () => {
  const { POST } = await import("./setup/route");
  const admin = await user("system_admin");
  const result = await POST(
    req(admin, {
      action: "prepare",
      mode: "local",
      candidateId: "a".repeat(64),
      profiles: [],
      timezone: "Asia Seoul",
    }),
  );
  assert.equal(result.status, 400);
  assert.equal((await result.json()).errorCode, "timezone_invalid");
});
test("시간대를 보내지 않아도 준비 요청은 그대로 진행된다", async () => {
  const { POST } = await import("./setup/route");
  const admin = await user("system_admin");
  // 운영자가 스위치를 꺼 두었으므로 timezone 검증을 통과한 뒤 권한 게이트에서 멈춘다.
  process.env.DESKRPG_HOST_SETUP_ENABLED = "0";
  const result = await POST(
    req(admin, {
      action: "prepare",
      mode: "local",
      candidateId: "a".repeat(64),
      profiles: [],
    }),
  );
  assert.equal((await result.json()).errorCode, "setup_forbidden");
  delete process.env.DESKRPG_HOST_SETUP_ENABLED;
});
