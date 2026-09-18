import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Task 5·6·7 리뷰 I-1 회귀 방어.
//
// 리뷰는 격리 사본에서 실증했다: `requireSystemAdmin` 게이트(GET·POST), `[name]/route.ts`
// DELETE 의 `system_admin` 분기, identity·config 의 프로필 토큰 선택을 전부 삭제해도
// `npm run test` 전체가 894 pass / 0 fail 로 그대로 통과했다. 이 batch 의 신규 테스트
// 25건이 전부 순수 함수(validation/stripApiKey/attachKeyStorage/selectProfileToken)만
// 물었기 때문이다 — 라우트 핸들러를 실행하는 테스트가 하나도 없었다. 이 파일이 그
// 구멍을 닫는다: 실제 `route.ts` 를 import 해 핸들러를 직접 호출한다.
//
// DB-backed 패턴은 local-discovery-route.test.ts / npcs/rebind-route.test.ts 와 동일 —
// `db` 는 지연 초기화되는 모듈 싱글턴이고 node:test 는 파일마다 별도 프로세스로 돌기
// 때문에, 모듈 스코프에서 SQLITE_PATH 를 한 번만 고정해 이 파일 전용 throwaway DB 에
// 묶는다.
//
// 최상위 경로(`[id]` 세그먼트 밖)에 둔다 — node 의 테스트 러너가 파일을 glob 으로
// 수집할 때 `[id]` 를 문자 클래스로 오인해, 그 안에 중첩된 `*.test.ts` 는 절대
// 수집하지 못한다(profiles-probe-route.test.ts, local-discovery-route.test.ts 와 같은
// 이유로 이 파일도 형제 디렉토리가 아니라 여기 있다).

const sqlitePath = path.join(os.tmpdir(), `plugin-proxy-route-test-${crypto.randomUUID()}.db`);
process.env.DESKRPG_HOME = os.tmpdir();
process.env.SQLITE_PATH = sqlitePath;
for (const ext of ["", "-wal", "-shm"]) {
  process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
}

async function loadDb() {
  return import("@/db");
}

async function seedUser(systemRole: "user" | "system_admin") {
  const { db, users } = await loadDb();
  const [user] = await db
    .insert(users)
    .values({
      loginId: `u-${crypto.randomUUID().slice(0, 8)}`,
      nickname: `u-${crypto.randomUUID().slice(0, 8)}`,
      passwordHash: "hash",
      systemRole,
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

function getReq(url: string, userId: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: { "x-user-id": userId } });
}

function mutatingReq(
  url: string,
  userId: string,
  method: "POST" | "DELETE",
  body?: unknown,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "x-user-id": userId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// 아무도 듣지 않는 루프백 주소. 이 스위트의 403 테스트는 여기까지 도달하면 실패해야
// 정상이다 — 권한 게이트가 살아 있으면 플러그인 호출 전에 이미 반환되므로 네트워크가
// 전혀 필요 없다.
const UNREACHABLE_BASE_URL = "http://127.0.0.1:1";

describe("plugin proxy 권한 게이트 — 비-system_admin 은 목록·생성·삭제를 못 한다 (I-1a)", () => {
  test("비-system_admin 게이트웨이 소유자의 GET /plugin/profiles → 403 forbidden", async () => {
    const owner = await seedUser("user");
    const gateway = await seedGateway(owner.id, UNREACHABLE_BASE_URL);
    const { GET } = await import("./[id]/plugin/profiles/route");
    const res = await GET(
      getReq(`http://localhost/api/gateways/${gateway.id}/plugin/profiles`, owner.id),
      { params: Promise.resolve({ id: gateway.id }) },
    );
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.errorCode, "forbidden");
  });

  test("비-system_admin 게이트웨이 소유자의 POST /plugin/profiles → 403 forbidden (플러그인을 부르지 않는다)", async () => {
    const owner = await seedUser("user");
    const gateway = await seedGateway(owner.id, UNREACHABLE_BASE_URL);
    const { POST } = await import("./[id]/plugin/profiles/route");
    const res = await POST(
      mutatingReq(`http://localhost/api/gateways/${gateway.id}/plugin/profiles`, owner.id, "POST", {
        name: "noah",
      }),
      { params: Promise.resolve({ id: gateway.id }) },
    );
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.errorCode, "forbidden");
  });

  test("비-system_admin 게이트웨이 소유자의 DELETE /plugin/profiles/{name} → 403 forbidden (플러그인을 부르지 않는다)", async () => {
    const owner = await seedUser("user");
    const gateway = await seedGateway(owner.id, UNREACHABLE_BASE_URL);
    const { DELETE } = await import("./[id]/plugin/profiles/[name]/route");
    const res = await DELETE(
      mutatingReq(
        `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah`,
        owner.id,
        "DELETE",
      ),
      { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
    );
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.errorCode, "forbidden");
  });
});

describe("plugin proxy 토큰 스코프 — 미등록 프로필은 default 로 폴백하지 않는다 (I-1b)", () => {
  test("미등록 프로필의 identity GET → 404 no_profile", async () => {
    const admin = await seedUser("system_admin");
    const gateway = await seedGateway(admin.id, UNREACHABLE_BASE_URL);
    const { GET } = await import("./[id]/plugin/profiles/[name]/identity/route");
    const res = await GET(
      getReq(`http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah/identity`, admin.id),
      { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
    );
    // identity/config 의 GET 은 모든 분기에서 NextResponse 를 반환하지만, `resolve()`
    // 가 판별 유니언을 반환하는 방식 때문에 TS 가 반환형에 `| undefined` 를 섞어 넣는다
    // (재현: 두 개의 `?: undefined` 형제 프로퍼티를 가진 유니언을 async 함수에서
    // `"in"` 으로 좁혀도 추론된 반환형에는 undefined 가 남는다). 런타임에는 절대
    // undefined 가 아니므로, 단언으로 좁히고 넘어간다 — route.ts 자체를 고치는 문제는
    // 아니다.
    assert.ok(res, "GET 은 항상 NextResponse 를 반환해야 한다");
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.errorCode, "no_profile");
  });

  test("미등록 프로필의 config GET → 404 no_profile", async () => {
    const admin = await seedUser("system_admin");
    const gateway = await seedGateway(admin.id, UNREACHABLE_BASE_URL);
    const { GET } = await import("./[id]/plugin/profiles/[name]/config/route");
    const res = await GET(
      getReq(`http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah/config`, admin.id),
      { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
    );
    assert.ok(res, "GET 은 항상 NextResponse 를 반환해야 한다");
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.errorCode, "no_profile");
  });
});

describe("plugin proxy 토큰 스코프 — 등록된 프로필은 자기 토큰으로만 나간다 (I-1c)", () => {
  test("identity GET 이 Authorization: Bearer <프로필 토큰> 으로 나간다 — default(게이트웨이) 토큰이 아니다", async () => {
    // 로컬 스텁 게이트웨이. /p/{name}/deskrpg/identity 로 들어온 Authorization 헤더를
    // 그대로 기록한다 — 라우트가 어떤 토큰을 실제로 Bearer 로 보냈는지는 응답 바디로는
    // 알 수 없어서, 발신 요청 자체를 관찰해야 한다.
    const seenAuth: string[] = [];
    const server = http.createServer((httpReq, httpRes) => {
      seenAuth.push(httpReq.headers.authorization ?? "");
      httpRes.writeHead(200, { "content-type": "application/json" });
      httpRes.end(JSON.stringify({ body: "hello", isDefaultTemplate: false, revision: "rev-1" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);

      const { db, hermesProfiles } = await loadDb();
      const { encryptGatewayToken } = await import("@/lib/gateway-resources");
      const PROFILE_TOKEN = "profile-scoped-key-abcdefgh01";
      await db.insert(hermesProfiles).values({
        gatewayId: gateway.id,
        profileName: "noah",
        tokenEncrypted: encryptGatewayToken(PROFILE_TOKEN),
        displayName: "noah",
      });

      const { GET } = await import("./[id]/plugin/profiles/[name]/identity/route");
      const res = await GET(
        getReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah/identity`,
          admin.id,
        ),
        { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
      );
      assert.ok(res, "GET 은 항상 NextResponse 를 반환해야 한다");
      assert.equal(res.status, 200);
      assert.equal(seenAuth.length, 1, "라우트가 스텁 게이트웨이를 정확히 한 번 불러야 한다");
      assert.equal(seenAuth[0], `Bearer ${PROFILE_TOKEN}`);
      assert.notEqual(
        seenAuth[0],
        "Bearer gateway-default-key-1234567890",
        "default 로 폴백하면 안 된다 — 폴백하면 Hermes 가 401 을 내고 사용자는 " +
          "'이 프로필이 등록되지 않았다'는 진짜 원인을 볼 수 없다",
      );
    } finally {
      server.close();
    }
  });
});

describe("plugin proxy — keyIssued:true 인데 apiKey 가 비어 오면 이유를 남긴다 (M-3)", () => {
  test("POST /plugin/profiles 가 201 은 유지하되 keyStored:false 와 keyStoredError 를 함께 싣는다", async () => {
    // 플러그인이 "키는 발급했다"고 보고하면서 apiKey 자체를 빠뜨리는 드문 경로.
    // attachKeyStorage(safe, null) 을 그대로 쓰면 "발급 자체가 없었음"과 구분이 안 돼
    // 이유 없는 keyStored:false 가 나간다 — 여기서는 이유가 있어야 한다.
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(200, { "content-type": "application/json" });
      httpRes.end(JSON.stringify({ name: "noah", keyIssued: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);

      const { POST } = await import("./[id]/plugin/profiles/route");
      const res = await POST(
        mutatingReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles`,
          admin.id,
          "POST",
          { name: "noah" },
        ),
        { params: Promise.resolve({ id: gateway.id }) },
      );
      const body = await res.json();
      assert.equal(res.status, 201, "프로필 자체는 실제로 만들어졌으니 201 을 유지한다");
      assert.equal(body.keyIssued, true);
      assert.equal(body.keyStored, false);
      // 최종 리뷰 M-3: 이 값은 화면에 그대로 렌더되는 한국어 문장이 아니라
      // wizard-error-codes.ts 사전의 코드여야 한다 — en/ja/zh 사용자도 번역된
      // 문구를 본다.
      assert.equal(body.keyStoredError, "key_missing_after_issue");
      assert.equal("apiKey" in body, false);
    } finally {
      server.close();
    }
  });
});

describe("plugin proxy — DELETE 는 경로 순회 이름을 원격에 넘기지 않는다 (M-1)", () => {
  test("name '..' 는 400 invalid_profile_name 이고 플러그인을 부르지 않는다", async () => {
    // encodeURIComponent 는 "." 을 이스케이프하지 않는다. name==".." 이면
    // `/deskrpg/profiles/..` 가 URL 정규화로 `/deskrpg/` 에 접혀 프로필 스코프가
    // 조용히 사라진다(profile-name.ts 의 경고 그대로) — 검증 없이 원격에 넘기면 안 된다.
    const admin = await seedUser("system_admin");
    const gateway = await seedGateway(admin.id, UNREACHABLE_BASE_URL);
    const { DELETE } = await import("./[id]/plugin/profiles/[name]/route");
    const res = await DELETE(
      mutatingReq(
        `http://localhost/api/gateways/${gateway.id}/plugin/profiles/..`,
        admin.id,
        "DELETE",
      ),
      { params: Promise.resolve({ id: gateway.id, name: ".." }) },
    );
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.errorCode, "invalid_profile_name");
  });
});

describe("plugin proxy — DELETE 성공 시 로컬 등록 행을 함께 지운다 (M-4)", () => {
  test("원격 삭제가 성공하면 hermes_profiles 행도 사라진다", async () => {
    // 안 지우면 게이트웨이에는 없는 프로필이 DeskRPG 목록에 남고, 거기 묶인 NPC 는
    // 대화 시점에야 실패한다.
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(200, { "content-type": "application/json" });
      httpRes.end(
        JSON.stringify({ name: "noah", removed: { profileDir: true, wrapperScript: true } }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);

      const { db, hermesProfiles } = await loadDb();
      const { encryptGatewayToken } = await import("@/lib/gateway-resources");
      await db.insert(hermesProfiles).values({
        gatewayId: gateway.id,
        profileName: "noah",
        tokenEncrypted: encryptGatewayToken("profile-scoped-key-abcdefgh01"),
        displayName: "noah",
      });

      const { DELETE } = await import("./[id]/plugin/profiles/[name]/route");
      const res = await DELETE(
        mutatingReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah`,
          admin.id,
          "DELETE",
        ),
        { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
      );
      assert.equal(res.status, 200);

      const { eq, and } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(hermesProfiles)
        .where(
          and(eq(hermesProfiles.gatewayId, gateway.id), eq(hermesProfiles.profileName, "noah")),
        );
      assert.equal(rows.length, 0, "삭제 성공 후 로컬 등록 행이 남아 있으면 안 된다");
    } finally {
      server.close();
    }
  });
});

describe("plugin proxy — 실패 응답에 upstreamStatus 를 함께 싣는다 (수정 라운드 1)", () => {
  // 프록시는 실패를 항상 HTTP 200 + errorCode 로 옮긴다(Cloudflare 가 origin 5xx 를
  // 자기 페이지로 갈아치우는 문제의 연장선). 그 과정에서 원래 있던 업스트림 상태
  // 코드가 함께 사라지면, 구조화 `error` 필드 없는 401 과 404 가 둘 다 `plugin_error`
  // 로 뭉쳐 "401 과 404 는 사용자가 할 일이 정반대다" 원칙이 이 층에서 재발한다
  // (classifyPluginProbe 가 게이트웨이 레벨에서 이미 겪은 문제). upstreamStatus 필드가
  // 그 원 상태 코드를 그대로 실어 보내는지 라우트 레벨에서 고정한다.

  test("identity GET — 업스트림 401(구조화 error 없음) 이 upstreamStatus:401 로 도착한다", async () => {
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(401, { "content-type": "application/json" });
      httpRes.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);
      const { db, hermesProfiles } = await loadDb();
      const { encryptGatewayToken } = await import("@/lib/gateway-resources");
      await db.insert(hermesProfiles).values({
        gatewayId: gateway.id,
        profileName: "noah",
        tokenEncrypted: encryptGatewayToken("profile-scoped-key-abcdefgh01"),
        displayName: "noah",
      });

      const { GET } = await import("./[id]/plugin/profiles/[name]/identity/route");
      const res = await GET(
        getReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah/identity`,
          admin.id,
        ),
        { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
      );
      assert.ok(res);
      const body = await res.json();
      assert.equal(res.status, 200, "실패도 200 규약을 유지한다");
      assert.equal(
        body.errorCode,
        "plugin_error",
        "구조화 error 필드가 없으면 여전히 뭉뚱그려진다",
      );
      assert.equal(body.upstreamStatus, 401, "그러나 원 상태 코드는 그대로 살아남는다");
    } finally {
      server.close();
    }
  });

  test("identity GET — 업스트림 404(구조화 error 없음) 이 upstreamStatus:404 로 도착한다", async () => {
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(404, { "content-type": "application/json" });
      httpRes.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);
      const { db, hermesProfiles } = await loadDb();
      const { encryptGatewayToken } = await import("@/lib/gateway-resources");
      await db.insert(hermesProfiles).values({
        gatewayId: gateway.id,
        profileName: "noah",
        tokenEncrypted: encryptGatewayToken("profile-scoped-key-abcdefgh01"),
        displayName: "noah",
      });

      const { GET } = await import("./[id]/plugin/profiles/[name]/identity/route");
      const res = await GET(
        getReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah/identity`,
          admin.id,
        ),
        { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
      );
      assert.ok(res);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.errorCode, "plugin_error");
      assert.equal(body.upstreamStatus, 404, "이 값이 없으면 401 과 404 를 화면에서 가를 수 없다");
    } finally {
      server.close();
    }
  });

  test("POST /plugin/profiles — 업스트림 409(already_exists) 도 upstreamStatus 를 싣는다", async () => {
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(409, { "content-type": "application/json" });
      httpRes.end(JSON.stringify({ error: "already_exists", name: "noah" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);

      const { POST } = await import("./[id]/plugin/profiles/route");
      const res = await POST(
        mutatingReq(
          `http://localhost/api/gateways/${gateway.id}/plugin/profiles`,
          admin.id,
          "POST",
          {
            name: "noah",
          },
        ),
        { params: Promise.resolve({ id: gateway.id }) },
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.errorCode, "already_exists");
      assert.equal(
        body.upstreamStatus,
        409,
        "명명된 코드가 있는 경로도 upstreamStatus 를 잃지 않는다",
      );
    } finally {
      server.close();
    }
  });

  test("DELETE /plugin/profiles/{name} — 네트워크 도달 실패는 upstreamStatus:0 이다", async () => {
    // UNREACHABLE_BASE_URL 은 아무도 듣지 않아 client 가 `{status:0}` 를 낸다
    // (plugin-client.ts 의 UNREACHABLE). 이 값도 그대로 실려야 "도달 못 함" 과
    // "원격이 거절함" 이 화면에서 갈린다.
    const admin = await seedUser("system_admin");
    const gateway = await seedGateway(admin.id, UNREACHABLE_BASE_URL);
    const { DELETE } = await import("./[id]/plugin/profiles/[name]/route");
    const res = await DELETE(
      mutatingReq(
        `http://localhost/api/gateways/${gateway.id}/plugin/profiles/noah`,
        admin.id,
        "DELETE",
      ),
      { params: Promise.resolve({ id: gateway.id, name: "noah" }) },
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.errorCode, "unreachable");
    assert.equal(body.upstreamStatus, 0);
  });
});

describe("plugin proxy — 만든 프로필이 실제로 몇 개 채널에 출근했는지 알린다", () => {
  // 마법사 ④ 배치는 "이미 채널에 자동 출근했습니다" 를 조건 없이 띄웠다. 출근은 그
  // 게이트웨이가 **이미 붙어 있는 채널** 에만 일어나므로, 붙은 채널이 없으면 그 문장은
  // 거짓이다(Hostinger VPS 실측 2026-09-17: 채널이 없는데도 출근했다고 안내했다).
  async function createProfile(gatewayId: string, adminId: string) {
    const { POST } = await import("./[id]/plugin/profiles/route");
    const res = await POST(
      mutatingReq(`http://localhost/api/gateways/${gatewayId}/plugin/profiles`, adminId, "POST", {
        name: "noah",
      }),
      { params: Promise.resolve({ id: gatewayId }) },
    );
    return { res, body: await res.json() };
  }

  async function withStubPlugin<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = http.createServer((_httpReq, httpRes) => {
      httpRes.writeHead(200, { "content-type": "application/json" });
      httpRes.end(
        JSON.stringify({ name: "noah", keyIssued: true, apiKey: "profile-key-abcdefghij" }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind stub server");
    try {
      return await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      server.close();
    }
  }

  test("붙은 채널이 없으면 attendedChannels 는 0 이다", async () => {
    await withStubPlugin(async (baseUrl) => {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);
      const { res, body } = await createProfile(gateway.id, admin.id);
      assert.equal(res.status, 201);
      assert.equal(body.keyStored, true);
      assert.equal(body.attendedChannels, 0, "채널이 없는데 출근했다고 말하면 안 된다");
    });
  });

  test("게이트웨이가 붙은 채널 수만큼 attendedChannels 가 온다", async () => {
    await withStubPlugin(async (baseUrl) => {
      const admin = await seedUser("system_admin");
      const gateway = await seedGateway(admin.id, baseUrl);
      const { seedChannel } = await import("@/test-setup/npc-seed");
      const { db, channelGatewayBindings } = await loadDb();
      for (const name of ["사무실 A", "사무실 B"]) {
        const channel = await seedChannel(admin.id, name);
        await db
          .insert(channelGatewayBindings)
          .values({ channelId: channel.id, gatewayId: gateway.id, boundByUserId: admin.id });
      }
      const { body } = await createProfile(gateway.id, admin.id);
      assert.equal(body.attendedChannels, 2);
    });
  });
});
