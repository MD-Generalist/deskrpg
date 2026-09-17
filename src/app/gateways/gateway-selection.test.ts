import assert from "node:assert/strict";
import test from "node:test";

import { nextSelectedGatewayId } from "./gateway-selection";

const rows = [{ id: "a" }, { id: "b" }];

test("선택이 비어 있으면 기본으로 첫 게이트웨이를 고른다", () => {
  assert.equal(nextSelectedGatewayId("", rows), "a");
});

test("지금 선택이 목록에 있으면 유지한다", () => {
  assert.equal(nextSelectedGatewayId("b", rows), "b");
});

test("autoSelect 가 꺼져 있으면 빈 선택을 유지한다 — 연결 마법사의 안내가 사라지지 않게", () => {
  assert.equal(nextSelectedGatewayId("", rows, { autoSelect: false }), "");
});

test("사라진 선택은 autoSelect 가 꺼져 있어도 비운다", () => {
  assert.equal(nextSelectedGatewayId("gone", rows, { autoSelect: false }), "");
});
