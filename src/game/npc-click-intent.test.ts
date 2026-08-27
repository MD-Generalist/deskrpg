import test from "node:test";
import assert from "node:assert/strict";

import { decideNpcClick, shouldRememberTarget } from "./npc-click-intent";

// --- 이미 옆에 서 있을 때: 예전에는 아무 일도 일어나지 않던 경우 ---

test("경로가 비면 그 자리에서 대화를 연다", () => {
  assert.equal(decideNpcClick({ pathLength: 0, clickedNpcId: "npc-1" }), "interact-now");
});

test("경로가 자기 타일 하나뿐이어도 그 자리에서 연다", () => {
  // findPath 는 시작 타일을 포함한다 — 길이 1 은 "움직일 필요 없음"이다.
  assert.equal(decideNpcClick({ pathLength: 1, clickedNpcId: "npc-1" }), "interact-now");
});

// --- 떨어져 있을 때: 기존 동작 ---

test("걸어가야 하면 도착 후 대화로 미룬다", () => {
  assert.equal(decideNpcClick({ pathLength: 2, clickedNpcId: "npc-1" }), "walk-then-interact");
});

test("먼 거리도 마찬가지다", () => {
  assert.equal(decideNpcClick({ pathLength: 9, clickedNpcId: "npc-1" }), "walk-then-interact");
});

// --- 빈 바닥 클릭 ---

test("NPC 가 아니면 이동만 한다", () => {
  assert.equal(decideNpcClick({ pathLength: 5, clickedNpcId: null }), "walk-only");
});

test("NPC 가 아니면 경로가 비어도 이동만 한다", () => {
  assert.equal(decideNpcClick({ pathLength: 0, clickedNpcId: null }), "walk-only");
});

// --- 목표 기억: 오염된 targetNpcId 를 막는 지점 ---

test("도착을 기다릴 때만 목표를 기억한다", () => {
  assert.equal(shouldRememberTarget("walk-then-interact"), true);
});

test("즉시 대화하면 기억하지 않는다", () => {
  // 기억해 두면 다음에 다른 곳으로 걸어가 도착할 때 엉뚱한 대화가 열린다.
  assert.equal(shouldRememberTarget("interact-now"), false);
});

test("이동만 할 때도 기억하지 않는다", () => {
  assert.equal(shouldRememberTarget("walk-only"), false);
});
