import assert from "node:assert/strict";
import test from "node:test";

import { GRAPH_PADDING, labelOnLeft, layoutGraph, timeRange, visibleAt } from "./graph-layout";

const g = {
  nodes: [
    { id: "a", label: "a", kind: "skill" as const, timestamp: 1 },
    { id: "b", label: "b", kind: "skill" as const, timestamp: 5 },
    { id: "m", label: "m", kind: "memory" as const, timestamp: null },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "a", target: "m" },
  ],
  stats: {},
};

test("같은 입력이면 같은 배치, 좌표는 캔버스 안", () => {
  const one = layoutGraph(g, { width: 400, height: 300, ticks: 50 });
  const two = layoutGraph(g, { width: 400, height: 300, ticks: 50 });
  assert.deepEqual(one, two);
  for (const n of one.nodes) assert.ok(n.x >= 0 && n.x <= 400 && n.y >= 0 && n.y <= 300);
});

test("끝점이 없는 간선은 버린다", () => {
  const out = layoutGraph(
    { ...g, edges: [{ source: "a", target: "ghost" }] },
    { width: 100, height: 100, ticks: 5 },
  );
  assert.equal(out.edges.length, 0);
});

test("입력 간선 배열을 바꾸지 않는다(d3 는 source/target 을 객체로 덮어쓴다)", () => {
  const edges = [{ source: "a", target: "b" }];
  layoutGraph({ ...g, edges }, { width: 100, height: 100, ticks: 5 });
  assert.deepEqual(edges, [{ source: "a", target: "b" }]);
});

test("시간 필터 — 시각이 없는 노드는 늘 보인다", () => {
  assert.deepEqual(
    visibleAt(g.nodes, 3).map((n) => n.id),
    ["a", "m"],
  );
  assert.equal(visibleAt(g.nodes, null).length, 3);
});

test("시간 범위는 시각이 있는 노드만으로, 없으면 null", () => {
  assert.deepEqual(timeRange(g.nodes), { min: 1, max: 5 });
  assert.equal(timeRange([{ timestamp: null }]), null);
});

test("가장자리에 여백을 둔다 — 노드가 한쪽으로 몰려도 좌표는 여백 안쪽", () => {
  const many = {
    nodes: Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      label: `n${i}`,
      kind: "skill" as const,
      timestamp: i,
    })),
    edges: [],
    stats: {},
  };
  const out = layoutGraph(many, { width: 200, height: 120, ticks: 100 });
  for (const n of out.nodes) {
    assert.ok(n.x >= GRAPH_PADDING && n.x <= 200 - GRAPH_PADDING, `x ${n.x}`);
    assert.ok(n.y >= GRAPH_PADDING && n.y <= 120 - GRAPH_PADDING, `y ${n.y}`);
  }
});

test("오른쪽 끝 가까운 노드는 라벨을 왼쪽에 둔다", () => {
  assert.equal(labelOnLeft(700, 720), true);
  assert.equal(labelOnLeft(100, 720), false);
});
