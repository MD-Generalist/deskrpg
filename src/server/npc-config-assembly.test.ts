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

/**
 * 응답 언어 계약은 **요청 시점의 언어**로 정한다. 새 고용 경로는 agent_config 를 NULL 로
 * 두므로, 예전처럼 agent_config.locale 만 보면 한국어 오피스에서도 "모든 발언은 영어로"
 * 계약이 실렸다(스테이징 실측: 올리버만 회의에서 영어로 답했다).
 */
const KO_CONTRACT = /응답 언어 계약/;
const EN_CONTRACT = /Response Language Contract/;

test("agent_config 가 없는 직원도 한국어 사용자의 요청이면 한국어 계약을 받는다", async () => {
  const { getNpcConfigsForChannel } = await import("./socket-handlers");
  const { hireGatewayProfilesIntoChannel } = await import("@/lib/npc-roster");

  const { channelId, gatewayId } = await seedChannelWithProfiles({ profiles: 1 });
  await hireGatewayProfilesIntoChannel(channelId, gatewayId);

  const [config] = await getNpcConfigsForChannel(channelId, "ko");
  assert.match(config.instructions ?? "", KO_CONTRACT);
  assert.doesNotMatch(config.instructions ?? "", EN_CONTRACT);
});

test("응답 언어 폴백 순서: 요청자 → agent_config.locale → en", async () => {
  const { resolveNpcInstructions } = await import("./socket-handlers");

  assert.match(resolveNpcInstructions({ locale: "en" }, "ko") ?? "", KO_CONTRACT, "요청자가 우선");
  assert.match(
    resolveNpcInstructions({ locale: "ko" }, null) ?? "",
    KO_CONTRACT,
    "요청자 없으면 직원 값",
  );
  assert.match(resolveNpcInstructions({}, null) ?? "", EN_CONTRACT, "둘 다 없을 때만 en");
});

test("agent_config.locale=ko 인 기존 직원은 요청 언어가 없어도 그대로 한국어다", async () => {
  const { resolveNpcInstructions } = await import("./socket-handlers");
  assert.match(resolveNpcInstructions({ locale: "ko" }) ?? "", KO_CONTRACT);
});

test("사용자가 직접 쓴 회의 규약은 요청 언어로 바꾸지 않는다", async () => {
  const { resolveNpcInstructions } = await import("./socket-handlers");
  const out = resolveNpcInstructions({ meetingProtocol: "MY RULES" }, "ko") ?? "";
  assert.match(out, /MY RULES/);
  assert.doesNotMatch(out, KO_CONTRACT);
});

test("회의·1:1·방 세 경로가 같은 해석 함수에 요청자 언어를 넘긴다", async () => {
  const { readFileSync } = await import("node:fs");
  const handlers = readFileSync(new URL("./socket-handlers.ts", import.meta.url), "utf8");
  const room = readFileSync(new URL("./room-runtime.ts", import.meta.url), "utf8");

  // 설정 로더 두 곳 모두 한 함수로 조립한다 — 경로별로 규약을 따로 만들지 않는다.
  assert.equal(handlers.match(/resolveNpcInstructions\(oc, requestLocale\)/g)?.length, 2);
  assert.equal(handlers.match(/composeNpcInstructions\(/g)?.length, 2, "해석 함수 밖 조립 없음");
  // 1:1 · 자유 회의 채팅 · 회의 토론 · 방 런타임이 소켓의 언어를 싣는다.
  assert.match(handlers, /getNpcConfig\(npcId, socketLocale\(socket\)\)/);
  assert.match(handlers, /getNpcConfigsForChannel\(channelId, socketLocale\(socket\)\)/);
  assert.match(
    handlers,
    /getOrCreateRoomRuntime\(io, room, userId, \{ locale: socketLocale\(socket\) \}\)/,
  );
  assert.match(room, /loadNpcConfigs\(room\.channelId, deps\.locale\)/);
});

test("옛 대화의 JSON 등록 지시는 폐기하고 현재 확인 화면을 안내한다", async () => {
  const { resolveNpcInstructions } = await import("./socket-handlers");
  for (const config of [{}, { meetingProtocol: "사용자 회의 규칙" }]) {
    const out = resolveNpcInstructions(config, "ko") ?? "";
    assert.match(out, /json:task/);
    assert.match(out, /카드로 등록/);
    assert.match(out, /폐기/);
    assert.match(out, /Hermes/);
  }
});
