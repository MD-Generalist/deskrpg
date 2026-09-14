import test from "node:test";
import assert from "node:assert/strict";
import { RemoteNpcPresentation } from "./remote-npc-presentation";

test("200ms authoritative packets produce continuous bounded visual steps", () => {
  const view = new RemoteNpcPresentation(0, 0);
  let changed = 0,
    largest = 0;
  for (let frame = 0; frame < 120; frame++) {
    if (frame % 12 === 0) view.accept((frame / 12 + 1) * 30, 0);
    const old = view.x;
    view.step(1000 / 60);
    if (view.x > old) changed++;
    largest = Math.max(largest, view.x - old);
  }
  assert.equal(changed, 120);
  assert.ok(largest < 7, `largest visible step ${largest}`);
  assert.ok(view.x <= 300, "presentation never extrapolates");
});
test("duplicate targets do not reset cadence and arrival keeps walking until visually settled", () => {
  const view = new RemoteNpcPresentation(0, 0);
  view.accept(30, 0);
  view.step(16);
  const first = view.x;
  view.accept(30, 0);
  view.step(16);
  assert.ok(view.x > first && view.walking);
  for (let i = 0; i < 80; i++) view.step(16);
  assert.equal(view.x, 30);
  assert.equal(view.walking, false);
});
test("refresh and ownership handoff snap without carrying a stale visual target", () => {
  const view = new RemoteNpcPresentation(0, 0);
  view.accept(30, 0);
  view.step(16);
  view.accept(96, 64, true);
  view.step(16);
  assert.deepEqual([view.x, view.y, view.walking], [96, 64, false]);
});
