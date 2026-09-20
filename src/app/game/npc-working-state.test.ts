import assert from "node:assert/strict";
import test from "node:test";

import { actorIndicator } from "@/game/three/bridge";

import {
  EMPTY_NPC_WORKING,
  parseNpcWorkingPayload,
  reduceNpcWorking,
  workingNpcCounts,
  workingNpcIds,
} from "./npc-working-state";

// R27: 맵의 "작업 중" 은 서버의 `npc:working` 만 접어 만든다. 켜짐·갱신·꺼짐·스냅샷 순서와
// 대화 응답 표시와의 우선순위를 여기서 고정한다.

const on = (npcId: string, runningCards = 1, cronRuns = 0) => ({
  npcId,
  working: true,
  sources: { runningCards, cronRuns },
});
const off = (npcId: string) => ({
  npcId,
  working: false,
  sources: { runningCards: 0, cronRuns: 0 },
});

test("npc:working — working:true 는 항목을 넣고, working:false 는 지운다", () => {
  let map = reduceNpcWorking(EMPTY_NPC_WORKING, on("a"));
  assert.deepEqual(workingNpcIds(map), ["a"]);
  map = reduceNpcWorking(map, on("b", 0, 1));
  assert.deepEqual(workingNpcIds(map).sort(), ["a", "b"]);
  map = reduceNpcWorking(map, off("a"));
  assert.deepEqual(workingNpcIds(map), ["b"]);
  assert.equal(map.a, undefined, "꺼진 NPC 는 맵에서 빠진다 — 기본값이 working:false 다");
});

test("npc:working — 같은 값이면 같은 객체를 돌려주고, 모르는 NPC 의 false 는 무해하다", () => {
  const map = reduceNpcWorking(EMPTY_NPC_WORKING, on("a", 2, 1));
  assert.equal(reduceNpcWorking(map, on("a", 2, 1)), map, "동일 페이로드는 렌더를 만들지 않는다");
  assert.equal(reduceNpcWorking(map, off("zzz")), map);
  const changed = reduceNpcWorking(map, on("a", 1, 1));
  assert.notEqual(changed, map);
  assert.deepEqual(changed.a.sources, { runningCards: 1, cronRuns: 1 });
  // 입력은 건드리지 않는다.
  assert.deepEqual(map.a.sources, { runningCards: 2, cronRuns: 1 });
});

test("npc:working — 페이로드 모양이 아니면 버리고, sources 가 빠지면 0 으로 채운다", () => {
  assert.equal(parseNpcWorkingPayload(null), null);
  assert.equal(parseNpcWorkingPayload({ npcId: "a" }), null);
  assert.equal(parseNpcWorkingPayload({ npcId: "", working: true }), null);
  assert.deepEqual(parseNpcWorkingPayload({ npcId: "a", working: true }), {
    npcId: "a",
    working: true,
    sources: { runningCards: 0, cronRuns: 0 },
  });
  assert.deepEqual(
    parseNpcWorkingPayload({
      npcId: "a",
      working: true,
      sources: { runningCards: 3, cronRuns: 1 },
    }),
    on("a", 3, 1),
  );
});

test("맵 표시 우선순위 — 대화 응답(queued/thinking/streaming)이 작업 중보다 앞선다 (R27)", () => {
  assert.equal(actorIndicator({ working: true }), "working");
  assert.equal(actorIndicator({ working: false }), null);
  assert.equal(actorIndicator({}), null);
  for (const phase of ["queued", "thinking", "streaming"] as const)
    assert.equal(actorIndicator({ phase, working: true }), phase, `${phase} 가 작업 중을 가린다`);
  // phase 가 idle/done/attention 이면 대화 표시가 없는 것 — 작업 중이 보인다.
  assert.equal(actorIndicator({ phase: "idle", working: true }), "working");
  assert.equal(actorIndicator({ phase: "done", working: true }), "working");
  assert.equal(actorIndicator({ phase: "attention", working: true }), "working");
  // 활동 말풍선(active) 은 thinking 으로 그려지므로 그쪽이 우선한다.
  assert.equal(actorIndicator({ active: true, working: true }), "thinking");
});

test("workingNpcCounts — 카드와 크론을 합쳐 NPC 별 건수를 준다", () => {
  const map = {
    a: { npcId: "a", working: true, sources: { runningCards: 2, cronRuns: 1 } },
    b: { npcId: "b", working: true, sources: { runningCards: 1, cronRuns: 0 } },
    c: { npcId: "c", working: false, sources: { runningCards: 0, cronRuns: 0 } },
  };
  assert.deepEqual(workingNpcCounts(map), { a: 3, b: 1 });
});

test("workingNpcCounts — 작업 중이 아닌 NPC 는 빠진다", () => {
  assert.deepEqual(
    workingNpcCounts({
      x: { npcId: "x", working: false, sources: { runningCards: 0, cronRuns: 0 } },
    }),
    {},
  );
});
