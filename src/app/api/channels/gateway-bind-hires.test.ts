import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  countMeetingMinutes,
  seedMeetingMinutes,
  seedTwoGateways,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// Task 6. 게이트웨이 연결은 "고용"이고 교체는 "휴면"이다.
//
// 예전에는 바인딩이 바뀌면 409 `gateway_change_requires_npc_reset` 을 던지고,
// 확인을 받으면 NPC 와 회의록을 **지웠다**. 프로필이 NPC 의 정본이 된 뒤로 그 파괴는
// 근거가 없다 — 옛 게이트웨이의 NPC 는 자리를 기억한 채 잠들고, 새 게이트웨이의
// 프로필이 출근하며, 채널 아티팩트는 그대로 남는다.
//
// `[id]` 세그먼트 밖(채널 API 루트)에 둔다 — node 테스트 러너가 `[id]` 를 문자
// 클래스로 오인해 그 안의 *.test.ts 를 못 줍는다.
setupThrowawaySqlite("gateway-bind-hires-test");

test("게이트웨이를 연결하면 출근하고, 다른 게이트웨이로 바꾸면 옛 NPC 는 휴면이고 회의록은 남는다", async () => {
  const { userId, channelId, gatewayA, gatewayB } = await seedTwoGateways({ profilesEach: 2 });
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { PUT } = await import("./[id]/gateway/route");
  const put = (gatewayId: string) =>
    PUT(
      new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
        method: "PUT",
        body: JSON.stringify({ gatewayId }),
        headers: authHeaders(userId),
      }),
      { params: Promise.resolve({ id: channelId }) },
    );

  assert.equal((await put(gatewayA)).status, 200);
  assert.equal((await selectChannelNpcs(channelId, { roster: true })).length, 2);
  await seedMeetingMinutes(channelId);

  const res = await put(gatewayB);
  assert.equal(res.status, 200, "예전의 409 gateway_change_requires_npc_reset 은 없다");

  const roster = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(roster.filter((n) => n.active).length, 2, "B 의 프로필이 출근");
  assert.equal(roster.filter((n) => !n.active).length, 2, "A 의 NPC 는 휴면");
  assert.equal(await countMeetingMinutes(channelId), 1, "회의록은 지우지 않는다");
});

test("옛 게이트웨이로 되돌리면 잠들어 있던 NPC 가 그대로 되살아난다", async () => {
  const { userId, channelId, gatewayA, gatewayB } = await seedTwoGateways({ profilesEach: 1 });
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { PUT } = await import("./[id]/gateway/route");
  const put = (gatewayId: string) =>
    PUT(
      new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
        method: "PUT",
        body: JSON.stringify({ gatewayId }),
        headers: authHeaders(userId),
      }),
      { params: Promise.resolve({ id: channelId }) },
    );

  await put(gatewayA);
  await put(gatewayB);
  await put(gatewayA);

  const roster = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(roster.length, 2, "행은 늘지 않는다 — 되살릴 뿐이다");
  assert.equal(roster.filter((n) => n.active).length, 1, "A 의 NPC 만 다시 출근");
});

test("연결을 해제하면 NPC 는 지워지지 않고 잠든다 — 자리도 회의록도 그대로", async () => {
  const { userId, channelId, gatewayA } = await seedTwoGateways({ profilesEach: 2 });
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { db, npcs } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { PUT, DELETE } = await import("./[id]/gateway/route");

  const put = () =>
    PUT(
      new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
        method: "PUT",
        body: JSON.stringify({ gatewayId: gatewayA }),
        headers: authHeaders(userId),
      }),
      { params: Promise.resolve({ id: channelId }) },
    );

  assert.equal((await put()).status, 200);
  // 자리를 준다 — 휴면이 자리를 기억하는지 보려면 자리가 있어야 한다.
  const hired = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(hired.length, 2);
  for (const [i, npc] of hired.entries()) {
    await db.update(npcs).set({ positionX: i, positionY: 3 }).where(eq(npcs.id, npc.id));
  }
  await seedMeetingMinutes(channelId);

  // 예전에는 확인 없이 부르면 409 gateway_disconnect_requires_npc_reset 였다.
  const res = await DELETE(
    new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
      method: "DELETE",
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: channelId }) },
  );
  assert.equal(res.status, 200, "예전의 409 gateway_disconnect_requires_npc_reset 은 없다");

  const slept = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(slept.length, 2, "NPC 는 지워지지 않는다");
  assert.equal(slept.filter((n) => n.active).length, 0, "전부 휴면");
  assert.deepEqual(
    slept.map((n) => [n.positionX, n.positionY]).sort(),
    [
      [0, 3],
      [1, 3],
    ],
    "자리는 기억한다",
  );
  assert.equal(await countMeetingMinutes(channelId), 1, "회의록은 지우지 않는다");

  // 다시 연결하면 새로 만드는 것이 아니라 되살린다 — 잠든 수만큼 정확히.
  const { hireGatewayProfilesIntoChannel } = await import("@/lib/npc-roster");
  assert.deepEqual(
    await hireGatewayProfilesIntoChannel(channelId, gatewayA),
    { created: 0, reactivated: 2 },
    "되살림 2, 신규 0",
  );

  // 라우트로 다시 연결해도 행이 늘거나 자리가 흐트러지지 않는다(멱등).
  assert.equal((await put()).status, 200);
  const back = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(back.length, 2);
  assert.equal(back.filter((n) => n.active).length, 2, "다시 출근");
  assert.deepEqual(
    back.map((n) => [n.positionX, n.positionY]).sort(),
    [
      [0, 3],
      [1, 3],
    ],
    "자리를 되찾는다",
  );
});

test("연결이 그대로면 설정만 저장하는 PUT 은 잠든 NPC 를 되살리지 않는다", async () => {
  const { userId, channelId, gatewayA } = await seedTwoGateways({ profilesEach: 2 });
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { setNpcActive } = await import("@/lib/npc-roster");
  const { PUT } = await import("./[id]/gateway/route");
  const put = (body: Record<string, unknown>) =>
    PUT(
      new NextRequest(`http://localhost/api/channels/${channelId}/gateway`, {
        method: "PUT",
        body: JSON.stringify(body),
        headers: authHeaders(userId),
      }),
      { params: Promise.resolve({ id: channelId }) },
    );

  assert.equal((await put({ gatewayId: gatewayA })).status, 200);
  const [first] = await selectChannelNpcs(channelId, { roster: true });
  await setNpcActive(first.id, false);

  // 같은 게이트웨이를 다시 저장. 여기서 고용을 돌면 사용자가 직접 재운 NPC 가
  // 조용히 되살아난다.
  assert.equal((await put({ gatewayId: gatewayA })).status, 200);

  const roster = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(
    roster.find((n) => n.id === first.id)?.active,
    false,
    "사용자가 재운 NPC 는 설정 저장으로 되살아나지 않는다",
  );
});
