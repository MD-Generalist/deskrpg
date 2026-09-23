import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

import type { LearningGraph, LearningNode } from "@/lib/hermes/plugin-client-types";

type Sim = LearningNode & SimulationNodeDatum;
export type PlacedNode = LearningNode & { x: number; y: number };

/** FNV-1a 로 id 를 [0,1) 에 흩는다 — 초기 위치를 난수 대신 이것으로 두어 배치가 매번 같다. */
function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/**
 * 학습 관계도를 2D force 로 배치한다. 결정적이다(초기 위치를 id 해시로, 시뮬레이션은 멈춘 채 `ticks` 번만 돈다).
 * 끝점이 없는 간선은 버리고, 좌표는 캔버스 안으로 자른다. d3 가 간선 객체를 덮어쓰므로 입력은 복사해 넘긴다.
 */
export function layoutGraph(
  graph: LearningGraph,
  opts: { width: number; height: number; ticks?: number },
): { nodes: PlacedNode[]; edges: { source: string; target: string }[] } {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodes: Sim[] = graph.nodes.map((n) => ({
    ...n,
    x: seed(n.id) * opts.width,
    y: seed(`${n.id}#`) * opts.height,
  }));
  const edges = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-60))
    .force(
      "link",
      forceLink(edges.map((e) => ({ ...e })))
        .id((d) => (d as Sim).id)
        .distance(60),
    )
    .force("center", forceCenter(opts.width / 2, opts.height / 2))
    .stop();
  for (let i = 0; i < (opts.ticks ?? 200); i += 1) sim.tick();
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      timestamp: n.timestamp ?? null,
      category: n.category,
      x: clamp(n.x ?? 0, opts.width),
      y: clamp(n.y ?? 0, opts.height),
    })),
    edges,
  };
}

/** 시간 슬라이더 — `t` 이하의 시각을 가진 노드만. 시각이 없는 노드(메모리 등)는 늘 보인다. `t=null` 이면 전부. */
export function visibleAt<T extends { timestamp?: number | null }>(
  nodes: T[],
  t: number | null,
): T[] {
  return t === null ? nodes : nodes.filter((n) => n.timestamp == null || n.timestamp <= t);
}

/** 슬라이더의 양 끝. 시각이 있는 노드가 없으면 `null`(슬라이더를 그리지 않는다). */
export function timeRange(
  nodes: { timestamp?: number | null }[],
): { min: number; max: number } | null {
  const stamps = nodes.map((n) => n.timestamp).filter((s): s is number => typeof s === "number");
  if (stamps.length === 0) return null;
  return { min: Math.min(...stamps), max: Math.max(...stamps) };
}
