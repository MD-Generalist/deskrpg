import test from "node:test";
import assert from "node:assert/strict";
import { studioReviewRooms, createReviewWalk, sampleReviewWalk } from "./studio-review";
import { buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { clearSegment } from "../navigation";
test("review uses nine authoritative studio zones", () => {
  assert.equal(studioReviewRooms.length, 9);
  assert.equal(studioReviewRooms.find((r) => r.id === "meeting")?.x, 37);
  assert.equal(studioReviewRooms.find((r) => r.id === "studio-director")?.label, "스튜디오 대표실");
});
test("review player walks body-clear routes to every integer seat then stops at its anchor", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    blocked = new Set(map.blocked),
    walkable = (x: number, y: number) =>
      x >= 1 && x < 41 && y >= 1 && y < 25 && !blocked.has(`${x},${y}`);
  for (const seat of furnitureSeats(map.objects)) {
    const actor = {
      id: "p",
      kind: "player" as const,
      name: "Player",
      x: 23.5 * 32,
      y: 23.5 * 32,
      direction: "down",
      walking: false,
    };
    const route = createReviewWalk(actor, seat.anchorX! * 32, seat.anchorZ! * 32, walkable);
    assert.ok(route);
    for (let i = 1; i < route.points.length; i++)
      assert.ok(clearSegment(route.points[i - 1], route.points[i], walkable));
    const halfway = sampleReviewWalk(route, route.total / 3);
    assert.equal(halfway.walking, true);
    const end = sampleReviewWalk(route, 1e6);
    assert.equal(end.x, seat.anchorX! * 32);
    assert.equal(end.y, seat.anchorZ! * 32);
    assert.equal(end.walking, false);
  }
});

test("fractional floor clicks normalize to logical anchors and fractional retargets preserve continuity", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    blocked = new Set(map.blocked),
    walkable = (x: number, y: number) =>
      x >= 1 && x < 41 && y >= 1 && y < 25 && !blocked.has(`${x},${y}`);
  const actor = {
    id: "p",
    kind: "player" as const,
    name: "Player",
    x: 23.5 * 32,
    y: 23.5 * 32,
    direction: "down",
    walking: false,
  };
  const route = createReviewWalk(actor, 24.5 * 32 + 1, 23.5 * 32 + 1, walkable);
  assert.ok(route);
  const departure = sampleReviewWalk(route, 0);
  assert.equal(departure.walking, true);
  assert.equal(departure.x, actor.x);
  assert.equal(departure.y, actor.y);
  const end = sampleReviewWalk(route, 1e6);
  assert.equal(end.x, 24.5 * 32);
  assert.equal(end.y, 23.5 * 32);
  const moving = sampleReviewWalk(route, 0.2),
    retarget = createReviewWalk(moving, 23.5 * 32 + 3, 22.5 * 32 + 2, walkable);
  assert.ok(retarget);
  const next = sampleReviewWalk(retarget, 0);
  assert.equal(next.x, moving.x);
  assert.equal(next.y, moving.y);
  for (let i = 1; i < retarget.points.length; i++)
    assert.ok(clearSegment(retarget.points[i - 1], retarget.points[i], walkable));
  assert.equal(sampleReviewWalk(retarget, 1e6).y, 22.5 * 32);
  assert.equal(createReviewWalk(actor, NaN, 23 * 32, walkable), null);
  assert.equal(createReviewWalk(actor, 0, 0, walkable), null);
});
