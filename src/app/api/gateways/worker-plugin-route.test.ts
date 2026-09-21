import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// `POST /api/gateways/[id]/plugin/worker-plugin` — 칸반·크론 결과물이 쌓이지 않는 직원을 고치고
// **캐시를 다시 채운다**. 적용만 하고 캐시를 두면(최대 1시간 낡는다) 경고가 그대로 남는다 —
// 그 배선을 순수 함수 테스트로는 못 잡으므로 라우트를 실제로 돌린다(gateway-test-route.test.ts 와
// 같은 수법: 버리는 SQLite + 로컬 스텁 Hermes). `[id]` 밖에 두는 이유도 같다.

const sqlitePath = path.join(os.tmpdir(), `worker-plugin-route-test-${crypto.randomUUID()}.db`);
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

function postReq(url: string, userId: string, origin = "http://localhost"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "x-user-id": userId, origin, host: "localhost" },
  });
}

const GAP = { profile: "sophie", link: "missing", enabled: false, disabled: false };

/** 적용 전에는 sophie 가 빠져 있고, `POST /deskrpg/worker-plugin` 뒤에는 빈 목록을 보고한다. */
function startStubHermes() {
  const state = { applied: false, ensureCalls: 0 };
  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health") return json(200, { status: "ok" });
    if (req.url === "/v1/models") return json(200, { data: [] });
    if (req.url === "/deskrpg/info") {
      return json(200, {
        plugin: "deskrpg",
        version: "0.12.0",
        capabilities: ["kanban", "cron", "events", "worker_plugin"],
        worker_plugin: { missing: state.applied ? [] : [GAP] },
      });
    }
    if (req.url === "/deskrpg/worker-plugin" && req.method === "POST") {
      state.ensureCalls += 1;
      state.applied = true;
      return json(200, { results: [{ profile: "sophie", link: "created", enabled: "added" }] });
    }
    return json(404, { error: "not found" });
  });
  return { server, state };
}

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind stub server");
  return `http://127.0.0.1:${address.port}`;
}

async function cachedWarning(gatewayId: string) {
  const { db, gatewayResources } = await loadDb();
  const { eq } = await import("drizzle-orm");
  const { restorePluginInfo } = await import("@/lib/hermes/plugin-cache-update");
  const { workerPluginWarning } = await import("@/lib/hermes/worker-plugin");
  const [row] = await db.select().from(gatewayResources).where(eq(gatewayResources.id, gatewayId));
  return workerPluginWarning(restorePluginInfo(row.pluginInfoJson));
}

describe("워커 플러그인 적용 라우트", () => {
  test("적용하고 캐시를 다시 채워 경고가 사라진다", async () => {
    const { server, state } = startStubHermes();
    const baseUrl = await listen(server);
    try {
      const owner = await seedUser();
      const gateway = await seedGateway(owner.id, baseUrl);
      // 적용 전 캐시: sophie 가 빠져 있다(연결 테스트가 채워 둔 상태를 흉내 낸다).
      const { db, gatewayResources } = await loadDb();
      const { eq } = await import("drizzle-orm");
      await db
        .update(gatewayResources)
        .set({
          pluginInfoJson: JSON.stringify({
            plugin: "deskrpg",
            version: "0.12.0",
            capabilities: ["kanban", "cron", "events", "worker_plugin"],
            timezone: null,
            kanban: { dispatcher_present: true, attachments: true },
            worker_plugin: { missing: [GAP] },
          }),
        })
        .where(eq(gatewayResources.id, gateway.id));
      assert.deepEqual(await cachedWarning(gateway.id), {
        fixable: ["sophie"],
        disabledByOperator: [],
      });

      const { POST } = await import("./[id]/plugin/worker-plugin/route");
      const res = await POST(
        postReq(`http://localhost/api/gateways/${gateway.id}/plugin/worker-plugin`, owner.id),
        { params: Promise.resolve({ id: gateway.id }) },
      );

      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        results: [{ profile: "sophie", link: "created", enabled: "added" }],
      });
      assert.equal(state.ensureCalls, 1);
      // 핵심: 캐시가 다시 채워져 경고가 없다.
      assert.equal(await cachedWarning(gateway.id), null);
    } finally {
      server.close();
    }
  });

  test("소유자가 아니면 404 이고 플러그인을 부르지 않는다", async () => {
    const { server, state } = startStubHermes();
    const baseUrl = await listen(server);
    try {
      const owner = await seedUser();
      const stranger = await seedUser();
      const gateway = await seedGateway(owner.id, baseUrl);
      const { POST } = await import("./[id]/plugin/worker-plugin/route");

      const res = await POST(
        postReq(`http://localhost/api/gateways/${gateway.id}/plugin/worker-plugin`, stranger.id),
        { params: Promise.resolve({ id: gateway.id }) },
      );

      assert.equal(res.status, 404);
      assert.equal(state.ensureCalls, 0);
    } finally {
      server.close();
    }
  });

  test("다른 출처의 요청은 403 이고 플러그인을 부르지 않는다", async () => {
    const { server, state } = startStubHermes();
    const baseUrl = await listen(server);
    try {
      const owner = await seedUser();
      const gateway = await seedGateway(owner.id, baseUrl);
      const { POST } = await import("./[id]/plugin/worker-plugin/route");

      const res = await POST(
        postReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/worker-plugin`,
          owner.id,
          "https://evil.example",
        ),
        { params: Promise.resolve({ id: gateway.id }) },
      );

      assert.equal(res.status, 403);
      assert.equal(state.ensureCalls, 0);
    } finally {
      server.close();
    }
  });
});
