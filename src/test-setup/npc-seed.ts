import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * NPC 관련 라우트/서버 테스트가 공유하는 씨앗 헬퍼.
 *
 * `npcs.hermes_profile_id` 가 NOT NULL 이 된 뒤로 "프로필 없는 NPC" 를 넣는 씨앗은
 * 스키마가 거부한다. 각 테스트가 users → gateway → profile → channel → npc 사슬을
 * 따로 베끼는 대신 여기 한 곳에 둔다. 관심사별로 함수를 하나씩 나눠 두었으니
 * 필요한 조각만 골라 조립하면 된다.
 *
 * `db` 는 지연 초기화되는 모듈 싱글턴이라, 임시 SQLite 를 쓰려면 `@/db` 가 처음
 * 로드되기 **전에** 환경변수가 잡혀 있어야 한다. 그래서 이 파일의 모든 헬퍼는
 * `@/db` 를 동적 import 한다 — 테스트 파일이 모듈 최상단에서 `setupThrowawaySqlite()`
 * 를 부르기만 하면 된다.
 */

/** 이 테스트 프로세스 전용 SQLite 파일을 잡고, 종료 시 지운다. */
export function setupThrowawaySqlite(label: string): string {
  const sqlitePath = path.join(os.tmpdir(), `${label}-${crypto.randomUUID()}.db`);
  // DATABASE_URL 이 환경에 있으면 @/db 는 그것을 보고 Postgres 로 붙는다(src/db/index.ts:22).
  // 임시 SQLite 를 쓰겠다는 의사를 명시한다 — 개발자의 셸에서 그냥 돌려도 같은 결과가 나온다.
  process.env.DB_TYPE = "sqlite";
  process.env.DESKRPG_HOME = os.tmpdir();
  process.env.SQLITE_PATH = sqlitePath;
  for (const ext of ["", "-wal", "-shm"]) {
    process.on("exit", () => fs.rmSync(`${sqlitePath}${ext}`, { force: true }));
  }
  return sqlitePath;
}

async function loadDb() {
  return import("@/db");
}

/**
 * `probeHermesGateway` 가 "hermes" 로 판정할 최소 스텁.
 * `/health` 는 2xx, `/v1/models` 는 JSON content-type 이어야 한다(gateway-probe.ts).
 */
export async function startStubHermesGateway(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", data: [] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind stub gateway");
  // 테스트 러너가 이 핸들 때문에 매달리지 않게 한다.
  server.unref();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

let sharedStub: { baseUrl: string; close: () => void } | null = null;
async function sharedStubBaseUrl() {
  if (!sharedStub) sharedStub = await startStubHermesGateway();
  return sharedStub.baseUrl;
}

export async function seedUser(prefix = "user") {
  const { db, users } = await loadDb();
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      loginId: `${prefix}-${suffix}`,
      nickname: `${prefix}-${suffix}`,
      passwordHash: "hash",
    })
    .returning();
  return user;
}

export async function seedGateway(ownerUserId: string, baseUrl = "http://gw.test") {
  const { db, gatewayResources } = await loadDb();
  const { encryptGatewayToken } = await import("@/lib/gateway-resources");
  const [gateway] = await db
    .insert(gatewayResources)
    .values({
      ownerUserId,
      displayName: "Test Gateway",
      baseUrl,
      tokenEncrypted: encryptGatewayToken("gateway-owner-key-1234567890"),
    })
    .returning();
  return gateway;
}

export async function seedHermesProfile(
  gatewayId: string,
  opts: { profileName?: string; displayName?: string | null; appearance?: unknown } = {},
) {
  const { db, hermesProfiles, jsonForDb } = await loadDb();
  const { encryptGatewayToken } = await import("@/lib/gateway-resources");
  const [profile] = await db
    .insert(hermesProfiles)
    .values({
      gatewayId,
      profileName: opts.profileName ?? `profile-${crypto.randomUUID().slice(0, 8)}`,
      tokenEncrypted: encryptGatewayToken("profile-key-1234567890"),
      displayName: opts.displayName ?? null,
      appearance: jsonForDb(opts.appearance ?? { bodyType: "female", layers: {} }),
    })
    .returning();
  return profile;
}

export async function seedChannel(ownerId: string, name = "Test Channel", mapData?: unknown) {
  const { db, channels, jsonForDb } = await loadDb();
  const [channel] = await db
    .insert(channels)
    .values(
      mapData !== undefined ? { name, ownerId, mapData: jsonForDb(mapData) } : { name, ownerId },
    )
    .returning();
  return channel;
}

export async function seedNpc(input: {
  channelId: string;
  hermesProfileId: string;
  name?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  active?: boolean;
  adapterType?: string;
  appearance?: unknown;
  agentConfig?: unknown;
}) {
  const { db, npcs, jsonForDb } = await loadDb();
  const [npc] = await db
    .insert(npcs)
    .values({
      channelId: input.channelId,
      hermesProfileId: input.hermesProfileId,
      name: input.name ?? "Test NPC",
      positionX: input.positionX ?? null,
      positionY: input.positionY ?? null,
      active: input.active ?? true,
      adapterType: input.adapterType ?? "hermes",
      appearance: jsonForDb(input.appearance ?? {}),
      agentConfig: jsonForDb(input.agentConfig ?? {}),
    })
    .returning();
  return npc;
}

/**
 * 채널 하나 + 게이트웨이 바인딩 + 요청한 조합의 NPC 들.
 *
 * - `placedActive`: 자리 있고 출근 중 — `/api/npcs` 의 기본 응답에 나와야 하는 유일한 종류
 * - `unplaced`: 프로필만 고용됐고 아직 자리가 없음 (`position_x/y` NULL)
 * - `dormant`: 자리는 기억하지만 퇴근 (`active = 0`)
 */
export async function seedChannelWithProfiles(opts: {
  placedActive?: number;
  unplaced?: number;
  dormant?: number;
  /** 게이트웨이에 등록만 하고 NPC 행은 만들지 않는 프로필 수 — "고용 전" 상태. */
  profiles?: number;
  /** `npcs.name` 에 남겨 둘 옛 값 — 응답에 새면 안 된다. */
  staleNpcName?: string;
  /** 첫 프로필의 표시 이름 — 응답의 `name` 은 이것이어야 한다. */
  displayName?: string;
  /** 채널의 맵 데이터 — 있으면 자리 배정 테스트가 실제 좌석을 계산할 수 있다. */
  mapData?: unknown;
}) {
  const { placedActive = 0, unplaced = 0, dormant = 0, profiles = 0 } = opts;

  const user = await seedUser("channel-owner");
  const gateway = await seedGateway(user.id, await sharedStubBaseUrl());
  const channel = await seedChannel(user.id, undefined, opts.mapData);

  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: user.id,
  });

  const profileIds: string[] = [];
  const npcIds: string[] = [];
  // 자리는 채널 안에서 유일해야 한다(npcs_channel_position_unique). 배치되는 NPC 마다
  // 한 칸씩 옆으로 민다.
  let nextColumn = 0;
  let isFirst = true;

  async function add(kind: "placedActive" | "unplaced" | "dormant") {
    const profile = await seedHermesProfile(gateway.id, {
      displayName: isFirst ? (opts.displayName ?? null) : null,
    });
    profileIds.push(profile.id);
    const placed = kind !== "unplaced";
    const npc = await seedNpc({
      channelId: channel.id,
      hermesProfileId: profile.id,
      name: isFirst ? (opts.staleNpcName ?? "Test NPC") : "Test NPC",
      positionX: placed ? nextColumn++ : null,
      positionY: placed ? 0 : null,
      active: kind !== "dormant",
    });
    npcIds.push(npc.id);
    isFirst = false;
  }

  for (let i = 0; i < placedActive; i += 1) await add("placedActive");
  for (let i = 0; i < unplaced; i += 1) await add("unplaced");
  for (let i = 0; i < dormant; i += 1) await add("dormant");
  for (let i = 0; i < profiles; i += 1) {
    const profile = await seedHermesProfile(gateway.id, {
      displayName: isFirst ? (opts.displayName ?? null) : null,
    });
    profileIds.push(profile.id);
    isFirst = false;
  }

  return {
    channelId: channel.id,
    gatewayId: gateway.id,
    profileIds,
    npcIds,
    userId: user.id,
  };
}

/** 게이트웨이 하나를 새 채널 여러 개에 바인딩한다 — `hireProfileIntoBoundChannels` 씨앗용. */
export async function seedGatewayBoundToChannels(opts: { channels: number }) {
  const user = await seedUser("gateway-owner");
  const gateway = await seedGateway(user.id, await sharedStubBaseUrl());

  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  const channelIds: string[] = [];
  for (let i = 0; i < opts.channels; i += 1) {
    const channel = await seedChannel(user.id);
    await bindGatewayToChannel({
      channelId: channel.id,
      gatewayId: gateway.id,
      boundByUserId: user.id,
    });
    channelIds.push(channel.id);
  }

  return { gatewayId: gateway.id, channelIds, userId: user.id };
}

/** 게이트웨이에 프로필 하나를 등록만 한다(NPC 행 없음). */
export async function seedProfile(gatewayId: string) {
  const profile = await seedHermesProfile(gatewayId);
  return profile.id;
}

/** 라우트 핸들러에 넘길 인증 헤더 — `getUserId` 는 `x-user-id` 하나만 본다. */
export function authHeaders(userId: string): Record<string, string> {
  return { "x-user-id": userId, "Content-Type": "application/json" };
}

/**
 * 채널 하나 + 게이트웨이 둘. 둘 다 아직 채널에 묶여 있지 않다 — 묶는 것은
 * 테스트가 `PUT /api/channels/:id/gateway` 로 직접 한다(그게 검증 대상이다).
 */
export async function seedTwoGateways(opts: { profilesEach: number }) {
  const user = await seedUser("two-gateways-owner");
  const baseUrl = await sharedStubBaseUrl();
  const gatewayA = await seedGateway(user.id, baseUrl);
  const gatewayB = await seedGateway(user.id, baseUrl);
  for (const gateway of [gatewayA, gatewayB]) {
    for (let i = 0; i < opts.profilesEach; i += 1) await seedHermesProfile(gateway.id);
  }
  const channel = await seedChannel(user.id);
  return {
    userId: user.id,
    channelId: channel.id,
    gatewayA: gatewayA.id,
    gatewayB: gatewayB.id,
  };
}

/** 채널에 회의록 한 건. 게이트웨이를 바꿔도 살아남아야 한다. */
export async function seedMeetingMinutes(channelId: string, topic = "주간 회의") {
  const { db, meetingMinutes } = await loadDb();
  const [row] = await db
    .insert(meetingMinutes)
    .values({ channelId, topic, transcript: "..." })
    .returning();
  return row;
}

export async function countMeetingMinutes(channelId: string): Promise<number> {
  const { db, meetingMinutes } = await loadDb();
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: meetingMinutes.id })
    .from(meetingMinutes)
    .where(eq(meetingMinutes.channelId, channelId));
  return rows.length;
}
