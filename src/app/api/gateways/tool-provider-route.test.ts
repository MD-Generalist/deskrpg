import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// 도구 프로바이더 프록시 라우트(0.10.0) 배선 검증 — 읽기는 게이트웨이 접근, 쓰기는 소유자 전용. 실제 route.ts 를 import 해
// 핸들러를 직접 부른다 — plugin-proxy-route.test.ts 와 같은 수법(throwaway SQLite +
// 로컬 스텁 게이트웨이). `[id]` 세그먼트 밖에 두는 이유도 같다(테스트 러너 glob).

const sqlitePath = path.join(os.tmpdir(), `tool-provider-route-test-${crypto.randomUUID()}.db`);
process.env.DESKRPG_HOME = os.tmpdir();
process.env.SQLITE_PATH = sqlitePath;
for (const ext of ["", "-wal", "-shm"]) {
  process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
}

const KEY_VALUE = "sk-SEEDED-SECRET-VALUE-0123456789";
const PROFILE_TOKEN = "profile-scoped-key-abcdefgh01";

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

async function seedGatewayWithProfile(ownerId: string, baseUrl: string) {
  const { db, gatewayResources, hermesProfiles } = await loadDb();
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
  await db.insert(hermesProfiles).values({
    gatewayId: gateway.id,
    profileName: "noah",
    tokenEncrypted: encryptGatewayToken(PROFILE_TOKEN),
    displayName: "noah",
  });
  return gateway;
}

async function shareGateway(gatewayId: string, userId: string) {
  const { db, gatewayShares } = await loadDb();
  await db.insert(gatewayShares).values({ gatewayId, userId });
}

type Seen = { method: string; url: string; auth: string; body: string };

async function startStub(
  respond: (seen: Seen) => { status: number; body: unknown },
): Promise<{ baseUrl: string; seen: Seen[]; close: () => void }> {
  const seen: Seen[] = [];
  const server = http.createServer((httpReq, httpRes) => {
    let raw = "";
    httpReq.on("data", (chunk) => (raw += chunk));
    httpReq.on("end", () => {
      const entry = {
        method: httpReq.method ?? "",
        url: httpReq.url ?? "",
        auth: httpReq.headers.authorization ?? "",
        body: raw,
      };
      seen.push(entry);
      const out = respond(entry);
      httpRes.writeHead(out.status, { "content-type": "application/json" });
      httpRes.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind stub server");
  return { baseUrl: `http://127.0.0.1:${address.port}`, seen, close: () => server.close() };
}

function toolPut(gatewayId: string, userId: string, toolset: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/gateways/${gatewayId}/plugin/profiles/noah/toolsets/${toolset}/provider`,
    {
      method: "PUT",
      headers: { "x-user-id": userId, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function toolGet(gatewayId: string, userId: string, toolset: string) {
  return new NextRequest(
    `http://localhost/api/gateways/${gatewayId}/plugin/profiles/noah/toolsets/${toolset}/providers`,
    { headers: { "x-user-id": userId } },
  );
}

const PUT_PATH = "./[id]/plugin/profiles/[name]/toolsets/[toolset]/provider/route";
const GET_PATH = "./[id]/plugin/profiles/[name]/toolsets/[toolset]/providers/route";

describe("도구 프로바이더 PUT — 소유자 전용, 키 값은 통과만", () => {
  test("소유자 PUT → 프로필 토큰으로 선택과 키를 넘기고 응답에 값이 없다", async () => {
    const stub = await startStub(() => ({
      status: 200,
      body: { provider: "OpenAI TTS", isSet: { VOICE_TOOLS_OPENAI_KEY: true } },
    }));
    try {
      const owner = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      const { PUT } = await import(PUT_PATH);
      const res = await PUT(
        toolPut(gateway.id, owner.id, "tts", {
          provider: "OpenAI TTS",
          env: { VOICE_TOOLS_OPENAI_KEY: KEY_VALUE },
        }),
        { params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }) },
      );
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text.includes(KEY_VALUE), false);
      assert.equal(stub.seen[0].method, "PUT");
      assert.equal(stub.seen[0].url, "/p/noah/deskrpg/toolsets/tts/provider");
      assert.equal(stub.seen[0].auth, `Bearer ${PROFILE_TOKEN}`);
      assert.deepEqual(JSON.parse(stub.seen[0].body), {
        provider: "OpenAI TTS",
        env: { VOICE_TOOLS_OPENAI_KEY: KEY_VALUE },
      });
    } finally {
      stub.close();
    }
  });

  test("공유 사용자 PUT → 403, 플러그인을 부르지 않는다", async () => {
    const stub = await startStub(() => ({ status: 200, body: {} }));
    try {
      const owner = await seedUser();
      const shared = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      await shareGateway(gateway.id, shared.id);
      const { PUT } = await import(PUT_PATH);
      const res = await PUT(
        toolPut(gateway.id, shared.id, "tts", { provider: "OpenAI TTS", env: { K_EY: KEY_VALUE } }),
        { params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }) },
      );
      assert.equal(res.status, 403);
      assert.equal(stub.seen.length, 0);
    } finally {
      stub.close();
    }
  });

  test("잘못된 본문 → 400 이고 값을 되돌려 주지 않는다", async () => {
    const stub = await startStub(() => ({ status: 200, body: {} }));
    try {
      const owner = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      const { PUT } = await import(PUT_PATH);
      const res = await PUT(
        toolPut(gateway.id, owner.id, "tts", { provider: "X", env: { bad_name: KEY_VALUE } }),
        { params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }) },
      );
      const text = await res.text();
      assert.equal(res.status, 400);
      assert.equal(text.includes(KEY_VALUE), false);
      assert.equal(stub.seen.length, 0);
    } finally {
      stub.close();
    }
  });

  test("플러그인이 설치가 필요하다고 거절하면 그 코드를 옮긴다", async () => {
    const stub = await startStub(() => ({
      status: 409,
      body: { error: "provider_needs_cli", detail: "hermes -p noah tools" },
    }));
    try {
      const owner = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      const { PUT } = await import(PUT_PATH);
      const res = await PUT(toolPut(gateway.id, owner.id, "tts", { provider: "Piper" }), {
        params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }),
      });
      assert.equal((await res.json()).errorCode, "provider_needs_cli");
    } finally {
      stub.close();
    }
  });
});

describe("도구 프로바이더 GET — 게이트웨이 접근이면 읽는다", () => {
  test("공유 사용자도 행을 읽는다(키 값은 원래 오지 않는다)", async () => {
    const stub = await startStub(() => ({
      status: 200,
      body: {
        toolset: "tts",
        hasProviders: true,
        providers: [],
        activeProvider: null,
        cliCommand: "x",
      },
    }));
    try {
      const owner = await seedUser();
      const shared = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      await shareGateway(gateway.id, shared.id);
      const { GET } = await import(GET_PATH);
      const res = await GET(toolGet(gateway.id, shared.id, "tts"), {
        params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }),
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).hasProviders, true);
      assert.equal(stub.seen[0].url, "/p/noah/deskrpg/toolsets/tts/providers");
    } finally {
      stub.close();
    }
  });

  test("구버전 플러그인(라우트 없음 404)은 업그레이드 필요로, 모르는 툴셋 404 는 그 코드로", async () => {
    let mode: "missing" | "unknown" = "missing";
    const stub = await startStub(() =>
      mode === "missing"
        ? { status: 404, body: { error: "Not Found" } }
        : { status: 404, body: { error: "toolset_not_found", detail: "ghost" } },
    );
    try {
      const owner = await seedUser();
      const gateway = await seedGatewayWithProfile(owner.id, stub.baseUrl);
      const { GET } = await import(GET_PATH);
      const ctx = { params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "tts" }) };
      const old = await (await GET(toolGet(gateway.id, owner.id, "tts"), ctx)).json();
      assert.equal(old.errorCode, "plugin_upgrade_required");
      mode = "unknown";
      const ctx2 = { params: Promise.resolve({ id: gateway.id, name: "noah", toolset: "ghost" }) };
      const unknown = await (await GET(toolGet(gateway.id, owner.id, "ghost"), ctx2)).json();
      assert.equal(unknown.errorCode, "toolset_not_found");
    } finally {
      stub.close();
    }
  });
});
