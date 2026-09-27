import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "gateway-restart-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

function req(
  gatewayId: string,
  userId?: string,
  origin = "http://localhost:3102",
  method = "POST",
) {
  return new NextRequest(`http://localhost:3102/api/gateways/${gatewayId}/restart`, {
    method,
    headers: {
      host: "localhost:3102",
      origin,
      ...(userId ? { "x-user-id": userId } : {}),
    },
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function user(role = "system_admin") {
  const { db, users } = await import("@/db");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Restart-${randomUUID()}`,
      passwordHash: "test-only",
      systemRole: role,
    })
    .returning();
  return row.id;
}

async function gateway(ownerUserId: string, baseUrl: string) {
  const { upsertOwnedGatewayResource } = await import("@/lib/gateway-resources");
  const row = await upsertOwnedGatewayResource({
    ownerUserId,
    baseUrl,
    token: "token-for-tests-0123456789",
    displayName: "내가 붙인 이름",
  });
  return row;
}

test("restarting needs a login and a same-origin request — it runs commands on the host", async () => {
  const { POST } = await import("./[id]/restart/route");
  const owner = await user();
  const row = await gateway(owner, "http://127.0.0.1:19642");
  assert.equal((await POST(req(row.id), params(row.id))).status, 401);
  assert.equal(
    (await POST(req(row.id, owner, "https://evil.example.com"), params(row.id))).status,
    403,
  );
});

test("someone else's gateway cannot be restarted, even when it is shared with them", async () => {
  const { POST } = await import("./[id]/restart/route");
  const owner = await user();
  const other = await user();
  const row = await gateway(owner, "http://127.0.0.1:19643");
  const res = await POST(req(row.id, other), params(row.id));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).errorCode, "setup_not_found");
});

test("a gateway DeskRPG only knows by address is refused with the reason", async () => {
  process.env.DESKRPG_HOST_SETUP_ENABLED = "1";
  const { POST } = await import("./[id]/restart/route");
  const owner = await user();
  const row = await gateway(owner, "http://host.docker.internal:8642");
  const res = await POST(req(row.id, owner), params(row.id));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errorCode, "plugin_update_unsupported_host");
});

test("an owner who may not run host setup, or with setup switched off, is refused", async () => {
  const { POST } = await import("./[id]/restart/route");
  const ordinary = await user("user");
  const ordinaryRow = await gateway(ordinary, "http://127.0.0.1:19645");
  const ordinaryRes = await POST(req(ordinaryRow.id, ordinary), params(ordinaryRow.id));
  assert.equal(ordinaryRes.status, 403);
  assert.equal((await ordinaryRes.json()).errorCode, "setup_forbidden");

  process.env.DESKRPG_HOST_SETUP_ENABLED = "0";
  const owner = await user();
  const row = await gateway(owner, "http://127.0.0.1:19644");
  const res = await POST(req(row.id, owner), params(row.id));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).errorCode, "setup_forbidden");
  process.env.DESKRPG_HOST_SETUP_ENABLED = "1";
});

test("GET says whether the button is offered, and always carries the command to run by hand", async () => {
  process.env.DESKRPG_HOST_SETUP_ENABLED = "1";
  const { GET } = await import("./[id]/restart/route");
  const owner = await user();
  const local = await gateway(owner, "http://127.0.0.1:19646");
  const remote = await gateway(owner, "http://host.docker.internal:8642");
  const ordinary = await user("user");
  const ordinaryRow = await gateway(ordinary, "http://127.0.0.1:19647");
  const other = await user();

  const read = async (id: string, who: string) => {
    const res = await GET(req(id, who, "http://localhost:3102", "GET"), params(id));
    return { status: res.status, body: await res.json() };
  };
  assert.deepEqual(await read(local.id, owner), {
    status: 200,
    body: { canRestart: true, command: "hermes gateway start" },
  });
  assert.deepEqual((await read(remote.id, owner)).body, {
    canRestart: false,
    reason: "no_host_access",
    command: "hermes gateway start",
  });
  assert.equal((await read(ordinaryRow.id, ordinary)).body.reason, "not_host_admin");
  assert.equal((await read(local.id, other)).body.reason, "not_owner");
  assert.equal((await read(randomUUID(), owner)).status, 404);
  const anonymous = await GET(
    req(local.id, undefined, "http://localhost:3102", "GET"),
    params(local.id),
  );
  assert.equal(anonymous.status, 401);
});
