import assert from "node:assert/strict";
import test from "node:test";

import { hireDoneHref, hirePageHref } from "./hire-navigation";

test("채용 마법사는 전용 페이지 주소를 갖는다", () => {
  assert.equal(hirePageHref("gw-1"), "/profiles/new?gateway=gw-1");
});

test("이어서 편집할 직원과 돌아갈 자리를 함께 싣는다", () => {
  assert.equal(
    hirePageHref("gw-1", { profile: "oliver", returnTo: "/game?channelId=c1" }),
    "/profiles/new?gateway=gw-1&profile=oliver&returnTo=%2Fgame%3FchannelId%3Dc1",
  );
});

test("게임에서 들어왔으면 그 자리로 돌아가 자리 지정까지 잇는다", () => {
  assert.equal(
    hireDoneHref("gw-1", "/game?channelId=c1&characterId=x"),
    "/game?channelId=c1&characterId=x&assignSeat=1",
  );
  assert.equal(hireDoneHref("gw-1", "/game"), "/game?assignSeat=1");
});

test("그 외에는 방금 만든 직원이 보이는 목록으로 돌아간다", () => {
  assert.equal(hireDoneHref("gw 1", null), "/profiles?gateway=gw%201");
});
