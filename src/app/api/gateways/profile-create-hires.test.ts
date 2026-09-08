import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedGatewayBoundToChannels,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// Task 6. 프로필 등록은 그 자체로 고용이다 — 게이트웨이가 이미 묶여 있는 채널
// **전부**에 즉시 출근한다. 예전에는 사용자가 채널마다 NPC 를 따로 만들어야 했다.
//
// 최상위(`[id]` 밖)에 둔다 — node 테스트 러너가 `[id]` 안의 *.test.ts 를 못 줍는다.
setupThrowawaySqlite("profile-create-hires-test");

test("프로필을 등록하면 그 게이트웨이가 묶인 모든 채널의 명단에 한 개씩 들어간다", async () => {
  const { gatewayId, channelIds, userId } = await seedGatewayBoundToChannels({ channels: 2 });
  const { selectChannelNpcs } = await import("@/lib/npc-projection");
  const { POST } = await import("./[id]/profiles/route");

  const res = await POST(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/profiles`, {
      method: "POST",
      body: JSON.stringify({ profileName: "sophie", token: "profile-key-1234567890" }),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId }) },
  );
  assert.equal(res.status, 201);

  for (const channelId of channelIds) {
    const roster = await selectChannelNpcs(channelId, { roster: true });
    assert.equal(roster.length, 1, `채널 ${channelId} 에 1개`);
    assert.equal(roster[0].profile.profileName, "sophie");
    assert.equal(roster[0].active, true);
    assert.equal(roster[0].positionX, null, "자리는 아직 없다 — 배치는 별도 행동이다");
  }
});
