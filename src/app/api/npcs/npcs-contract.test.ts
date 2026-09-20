import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedChannelWithProfiles,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";
import { buildOfficeEnvironment } from "@/game/three/office-environments";

// `GET /api/npcs?channelId=` 의 계약을 고정한다. 이 응답은 맵 시뮬레이션이 그대로 먹는다 —
// 형태가 조용히 바뀌면 맵이 깨지고, 그 사실은 브라우저에서야 드러난다.
//
// `db` 는 지연 초기화 싱글턴이고 node:test 는 파일마다 프로세스를 나누므로, 모듈
// 최상단에서 한 번 임시 DB 를 잡으면 이 파일의 모든 테스트가 그 DB 를 쓴다.
setupThrowawaySqlite("npcs-contract-test");

type NpcBody = {
  npcs: Array<{
    id: string;
    name: string;
    positionX: number | null;
    positionY: number | null;
    appearance: unknown;
    adapterType: string;
    hermesProfileId: string;
    active?: boolean;
    placed?: boolean;
  }>;
};

async function rawGet(query: string, userId: string) {
  const { GET } = await import("./route");
  return GET(
    new NextRequest(`http://localhost/api/npcs?${query}`, { headers: authHeaders(userId) }),
  );
}

async function get(query: string, userId: string): Promise<NpcBody> {
  const res = await rawGet(query, userId);
  assert.equal(res.status, 200);
  return (await res.json()) as NpcBody;
}

test("roster 없이 부르면 자리 미정·휴면 NPC 는 절대 나오지 않는다", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    placedActive: 1,
    unplaced: 1,
    dormant: 1,
  });

  const body = await get(`channelId=${channelId}`, userId);

  assert.equal(body.npcs.length, 1);
  for (const n of body.npcs) {
    assert.notEqual(
      n.positionX,
      null,
      "시뮬레이션이 positionX*TILE_SIZE 를 바로 계산한다 — null 이 새면 NaN 좌표다",
    );
    assert.notEqual(n.positionY, null);
    assert.equal(n.active, undefined, "roster 없이 부르면 active/placed 는 실리지 않는다");
    assert.equal(n.placed, undefined);
  }
});

test("roster=1 이면 셋 다 나오고 placed 가 구분한다", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    placedActive: 1,
    unplaced: 1,
    dormant: 1,
  });

  const body = await get(`channelId=${channelId}&roster=1`, userId);

  assert.equal(body.npcs.length, 3);
  assert.deepEqual(body.npcs.map((n) => `${n.placed}/${n.active}`).sort(), [
    "false/true",
    "true/false",
    "true/true",
  ]);
});

test("응답의 name 은 프로필 표시 이름이다 — npcs.name 의 옛 값이 아니다", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    placedActive: 1,
    staleNpcName: "옛이름",
    displayName: "올리버",
  });

  const body = await get(`channelId=${channelId}`, userId);

  assert.equal(body.npcs.length, 1);
  assert.equal(body.npcs[0].name, "올리버");
});

test("channelId 없이 부르면 400 이다 — 전 채널 NPC 를 흘리지 않는다", async () => {
  const { GET } = await import("./route");
  const user = await seedUser("no-channel");
  const res = await GET(
    new NextRequest("http://localhost/api/npcs", { headers: authHeaders(user.id) }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "channel_id_required");
});

// I6: roster=1 은 `profile.{gatewayId, profileName, displayName, ownerUserId}` 를 싣는다.
// 채널 UUID 만 아는 아무 로그인 사용자나 남의 사무실에 어떤 인격이 누구 소유로 몇 명
// 나와 있는지 읽을 수 있으면 안 된다.
test("채널 멤버가 아니면 출근부를 읽지 못한다", async () => {
  const { channelId } = await seedChannelWithProfiles({ placedActive: 1 });
  const outsider = await seedUser("outsider");

  const res = await rawGet(`channelId=${channelId}&roster=1`, outsider.id);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "not_a_member");

  const plain = await rawGet(`channelId=${channelId}`, outsider.id);
  assert.equal(plain.status, 403, "맵용 기본 응답도 같은 경계를 쓴다");
});

test("로그인하지 않으면 401 이다", async () => {
  const { channelId } = await seedChannelWithProfiles({ placedActive: 1 });
  const { GET } = await import("./route");
  const res = await GET(new NextRequest(`http://localhost/api/npcs?channelId=${channelId}`));
  assert.equal(res.status, 401);
});

test("roster=1 은 좌석 번호를 싣는다 — 데스크 좌석이면 번호, 서 있으면 null", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    unplaced: 5,
    mapData: buildOfficeEnvironment("executive"),
  });
  const { placeUnplacedNpcs } = await import("@/lib/npc-seating");
  await placeUnplacedNpcs(channelId);

  const body = await get(`channelId=${channelId}&roster=1`, userId);

  const numbers = body.npcs.map((n) => (n as unknown as { seatNumber: number | null }).seatNumber);
  assert.deepEqual(
    numbers.filter((n): n is number => n !== null).sort((a, b) => a - b),
    [1, 2, 3], // executive 맵은 데스크 3석 — 대표석은 직원 지정석이 아니다
  );
  assert.equal(numbers.filter((n) => n === null).length, 2);
});
