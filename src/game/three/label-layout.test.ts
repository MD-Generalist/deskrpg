import assert from "node:assert/strict";
import test from "node:test";
import {
  layoutActorLabels,
  overlaps,
  type ActorLabelAnchor,
  type OverlayRect,
} from "./label-layout";

const anchor = (id: string, priority = 0): ActorLabelAnchor => ({
  id,
  x: 190,
  feetY: 330,
  headY: 270,
  nameWidth: 95,
  nameHeight: 26,
  priority,
});
function verifyRects(rects: OverlayRect[], width: number, height: number) {
  for (const [i, rect] of rects.entries()) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= width && rect.y + rect.height <= height);
    for (const other of rects.slice(i + 1)) assert.equal(overlaps(rect, other), false);
  }
}
test("crowded mobile names keep local and hovered identities below feet without overlapping", () => {
  const actors = Array.from({ length: 12 }, (_, i) =>
    anchor(String(i), i === 10 ? 100 : i === 11 ? 110 : 0),
  );
  const result = layoutActorLabels(actors, 390, 600);
  assert.ok(result.placements.get("10")?.name);
  assert.ok(result.placements.get("11")?.name);
  const names = [...result.placements.values()].flatMap((p) => (p.name ? [p.name] : []));
  assert.ok(names.length >= 2 && names.length < actors.length);
  assert.ok(names.every((name) => name.y >= 340));
  verifyRects(names, 390, 600);
  assert.deepEqual(actors[0], anchor("0"), "layout does not mutate inputs");
});
test("every crowded visible speaker gets an inline bubble or scroll-rail entry", () => {
  const actors = Array.from({ length: 12 }, (_, i) => ({
    ...anchor(String(i), i === 0 ? 100 : 80),
    bubbleHeight: 76,
  }));
  const result = layoutActorLabels(actors, 390, 600);
  assert.ok(result.rail && result.overflow.length > 0);
  assert.ok([...result.placements.values()].some((p) => p.bubble));
  for (const actor of actors) {
    const placed = result.placements.get(actor.id)!;
    assert.ok(placed.bubble || placed.docked, actor.id);
    assert.notEqual(!!placed.bubble, !!placed.docked);
  }
  const rects = [...result.placements.values()].flatMap((p) =>
    [p.name, p.bubble].filter((r): r is OverlayRect => !!r),
  );
  verifyRects([...rects, result.rail!], 390, 600);
  assert.ok(result.placements.get("0")!.name);
});
test("sparse desktop labels retain each name and unclipped speech near viewport edges", () => {
  const actors = [
    { ...anchor("left", 100), x: 20, feetY: 180, headY: 100, bubbleHeight: 55 },
    { ...anchor("right"), x: 1180, feetY: 570, headY: 510 },
  ];
  const result = layoutActorLabels(actors, 1200, 700);
  assert.equal(result.overflow.length, 0);
  assert.ok(result.placements.get("left")!.bubble);
  assert.ok(result.placements.get("right")!.name);
  verifyRects(
    [...result.placements.values()].flatMap((p) =>
      [p.name, p.bubble].filter((r): r is OverlayRect => !!r),
    ),
    1200,
    700,
  );
});
test("input ordering does not flicker equal-priority placement and absent actors are never docked", () => {
  const actors = [anchor("b"), anchor("a"), anchor("c")];
  const first = layoutActorLabels(actors, 390, 600);
  const second = layoutActorLabels([...actors].reverse(), 390, 600);
  for (const actor of actors)
    assert.deepEqual(first.placements.get(actor.id), second.placements.get(actor.id));
  assert.equal(layoutActorLabels([], 390, 600).overflow.length, 0);
});

test("speech rail relocates away from a protected name near the top edge", () => {
  const actors = Array.from({ length: 12 }, (_, i) => ({
    ...anchor(String(i), i === 0 ? 100 : 0),
    feetY: 30,
    headY: 10,
    bubbleHeight: 76,
  }));
  const result = layoutActorLabels(actors, 390, 600);
  const localName = result.placements.get("0")!.name;
  assert.ok(localName && result.rail);
  assert.equal(overlaps(localName, result.rail), false);
});
