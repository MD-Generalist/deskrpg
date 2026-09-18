import assert from "node:assert/strict";
import test from "node:test";

import {
  employeeDetailHref,
  hireDoneHref,
  hireFinishedHref,
  hirePageHref,
} from "./hire-navigation";

test("채용 마법사는 전용 페이지 주소를 갖는다", () => {
  assert.equal(hirePageHref("gw-1"), "/profiles/new?gateway=gw-1");
});

test("이어서 편집할 직원과 돌아갈 자리를 함께 싣는다", () => {
  assert.equal(
    hirePageHref("gw-1", { profile: "oliver", returnTo: "/game?channelId=c1" }),
    "/profiles/new?gateway=gw-1&profile=oliver&returnTo=%2Fgame%3FchannelId%3Dc1",
  );
});

test("게임에서 들어왔으면 그 자리로 돌아간다", () => {
  assert.equal(hireDoneHref("gw-1", "/game?channelId=c1&view=x"), "/game?channelId=c1&view=x");
  assert.equal(hireDoneHref("gw-1", "/game"), "/game");
});

test("그 외에는 방금 만든 직원이 보이는 목록으로 돌아간다", () => {
  assert.equal(hireDoneHref("gw 1", null), "/profiles?gateway=gw%201");
});

test("직원 상세는 이름을 경로에, 게이트웨이를 쿼리에 싣는다", () => {
  assert.equal(employeeDetailHref("gw 1", "노아"), "/profiles/%EB%85%B8%EC%95%84?gateway=gw%201");
});

test("마법사를 완료하면 방금 만든 직원의 상세로 간다", () => {
  assert.equal(hireFinishedHref("gw-1", null, "mia"), "/profiles/mia?gateway=gw-1");
});

test("게임에서 들어왔거나 이름 없이 닫으면 예전 돌아갈 곳으로 간다", () => {
  assert.equal(hireFinishedHref("gw-1", "/game", "mia"), "/game");
  assert.equal(hireFinishedHref("gw-1", null, null), "/profiles?gateway=gw-1");
});
