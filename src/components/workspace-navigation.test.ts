import assert from "node:assert/strict";
import test from "node:test";

import { WORKSPACE_NAV, employeesHref } from "./workspace-navigation";

test("사이드바는 온보딩 순서대로 네 칸이다 — 내 캐릭터가 먼저다", () => {
  // 캐릭터가 없으면 사무실 화면이 캐릭터 화면으로 되돌려 보낸다. "나" 를 먼저 만드는 것이
  // 실제 순서이고, 순서가 흐트러지면 사용자가 다음 행동을 스스로 짐작해야 한다.
  assert.deepEqual(
    WORKSPACE_NAV.map((item) => item.href),
    ["/characters", "/gateways", "/profiles", "/channels"],
  );
});

test("레거시 AI 제공자 화면은 사이드바에 없다", () => {
  // Hermes 는 제공자 인증을 프로필마다 관리한다. 이 화면은 그 흐름과 이어지지 않는다.
  assert.equal(
    WORKSPACE_NAV.some((item) => item.href === "/providers"),
    false,
  );
});

test("내 캐릭터가 사이드바에 있다", () => {
  // 반드시 거쳐야 하는 단계인데 예전에는 /channels 가 되돌려 보낼 때만 만날 수 있었다.
  assert.equal(
    WORKSPACE_NAV.some((item) => item.href === "/characters"),
    true,
  );
});

test("직원 화면 주소는 게이트웨이와 이어서 할 일을 함께 싣는다", () => {
  assert.equal(employeesHref("gw-1"), "/profiles?gateway=gw-1");
  assert.equal(employeesHref("gw-1", { create: true }), "/profiles/new?gateway=gw-1");
  assert.equal(
    employeesHref("gw-1", { create: true, returnTo: "/game?channelId=c1&view=x" }),
    "/profiles/new?gateway=gw-1&returnTo=%2Fgame%3FchannelId%3Dc1%26view%3Dx",
  );
});
