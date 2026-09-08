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
