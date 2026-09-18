import test from "node:test";
import assert from "node:assert/strict";

import {
  assignSeats,
  freeSeatTiles,
  QUICK_START_APPEARANCE,
  quickStartChannelName,
  quickStartCharacterName,
  quickStartGamePath,
  quickStartSeatTiles,
} from "./quick-start";
import { validateOfficeAppearance } from "../game/three/office-appearance";
import { buildOfficeEnvironment } from "../game/three/office-environments";

test("기본 외형은 캐릭터 라우트의 검증을 통과하는 첫 번째 남성 룩이다", () => {
  assert.equal(validateOfficeAppearance(QUICK_START_APPEARANCE), null);
  assert.deepEqual(QUICK_START_APPEARANCE, { officeLookId: "office-jun", bodyType: "male" });
});

test("이름은 닉네임에서 나오고 길이 한도를 넘지 않는다", () => {
  assert.equal(quickStartCharacterName("  단테  "), "단테");
  assert.equal(quickStartCharacterName(""), "Player");
  assert.equal(quickStartCharacterName("x".repeat(80)).length, 50);
  assert.equal(quickStartChannelName(null), "My Office");
  assert.equal(quickStartChannelName("x".repeat(200)).length, 100);
});

test("기본 오피스 환경에서 좌석 타일을 뽑는다", () => {
  const seats = quickStartSeatTiles(buildOfficeEnvironment("trading"));
  assert.ok(seats.length > 0);
  assert.ok(seats.every((s) => Number.isInteger(s.col) && Number.isInteger(s.row)));
  assert.equal(new Set(seats.map((s) => `${s.col},${s.row}`)).size, seats.length, "중복 없음");
});

test("좌석이 없는 맵 데이터는 빈 배열이다", () => {
  assert.deepEqual(quickStartSeatTiles(null), []);
  assert.deepEqual(quickStartSeatTiles({ layers: {}, objects: [] }), []);
});

test("이미 앉아 있는 칸은 빈 좌석에서 빠진다 — 휴면 NPC 의 자리도 포함", () => {
  const seats = [
    { col: 1, row: 1 },
    { col: 2, row: 1 },
    { col: 3, row: 1 },
  ];
  const free = freeSeatTiles(seats, [
    { positionX: 2, positionY: 1 },
    { positionX: null, positionY: null },
  ]);
  assert.deepEqual(free, [
    { col: 1, row: 1 },
    { col: 3, row: 1 },
  ]);
});

test("빈 좌석보다 NPC 가 많으면 좌석 수만큼만 짝짓는다", () => {
  const plan = assignSeats(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
  );
  assert.deepEqual(plan, [
    { npcId: "a", seat: { col: 1, row: 1 } },
    { npcId: "b", seat: { col: 2, row: 1 } },
  ]);
});

test("게임 경로에는 채널만 실린다 — 캐릭터는 서버가 정한다", () => {
  assert.equal(quickStartGamePath({ channelId: "c 1" }), "/game?channelId=c+1");
});
