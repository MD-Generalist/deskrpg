import assert from "node:assert/strict";
import test from "node:test";

import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";

setupThrowawaySqlite("npc-config-assembly-test");

/**
 * 회의·자유채팅 참가자 명단을 조립하는 `getNpcConfigsForChannel` 의 계약 두 가지.
 *
 * 1) 새 고용 경로는 `agent_config` 를 NULL 로 둔다(프로필이 정본이므로). 그 상태로
 *    조립하면 `<team-instructions>` 층이 통째로 빠져 새로 만든 NPC 만 회의에서
 *    턴 규약 없이 말한다 — 기존 NPC 는 옛 agent_config 를 들고 있어 멀쩡하므로
 *    증상이 "새 직원만 이상하다"로 나타난다.
 * 2) 출근부에서 퇴근시킨(`active=false`) NPC 는 대화 표면에서도 빠져야 한다.
 *    자리 미정(unplaced)은 반대로 남는다 — 맵 밖에 있을 뿐 출근 중이다.
 */
test("고용된 NPC 는 agent_config 가 비어도 회의 규약을 받는다", async () => {
  const { getNpcConfigsForChannel } = await import("./socket-handlers");
  const { hireGatewayProfilesIntoChannel } = await import("@/lib/npc-roster");

  const { channelId, gatewayId } = await seedChannelWithProfiles({ profiles: 1 });
  await hireGatewayProfilesIntoChannel(channelId, gatewayId);

  const [config] = await getNpcConfigsForChannel(channelId);
  assert.ok(config, "고용된 NPC 가 명단에 있어야 한다");
  assert.match(
    config.instructions ?? "",
    /<team-instructions>/,
    "agent_config 가 NULL 이면 기본 회의 규약으로 떨어져야 한다",
  );
});

test("휴면 NPC 는 대화 명단에서 빠지고, 자리 미정은 남는다", async () => {
  const { getNpcConfigsForChannel } = await import("./socket-handlers");
  const { selectChannelNpcs } = await import("@/lib/npc-projection");

  const { channelId } = await seedChannelWithProfiles({ unplaced: 1, dormant: 1 });
  const roster = await selectChannelNpcs(channelId, { roster: true });
  assert.equal(roster.length, 2, "출근부에는 둘 다 보인다");

  const configs = await getNpcConfigsForChannel(channelId);
  assert.deepEqual(
    configs.map((c) => c.id).sort(),
    roster
      .filter((n) => n.active)
      .map((n) => n.id)
      .sort(),
    "퇴근시킨 NPC 는 자유채팅·회의에 들어오지 않는다",
  );
  assert.equal(configs.length, 1);
});
