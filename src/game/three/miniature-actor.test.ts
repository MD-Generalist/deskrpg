import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createMiniatureActor } from "./miniature-actor";
import { OFFICE_LOOKS } from "./office-looks";
import { MINIATURE_WALK_STRIDE } from "./commute-walk";
test("distance fallback planted sole travel matches cycle stride within 10%", () => {
  const actor = createMiniatureActor("contact", OFFICE_LOOKS[0], 0);
  const leg = actor.rig.children.find(
    (child) => child.position.y === 0.89 && child.position.x < 0,
  )!;
  const knee = leg.children.find((child) => child instanceof T.Group)!;
  const sole = knee.children[knee.children.length - 1];
  const sample = (phase: number) => {
    actor.update(0, true, "walking", false, phase);
    actor.root.updateMatrixWorld(true);
    return sole.getWorldPosition(new T.Vector3()).z;
  };
  const start = sample(-Math.PI / 4),
    end = sample(Math.PI / 4);
  assert.ok(Math.abs((start - end) * 4 - MINIATURE_WALK_STRIDE) / MINIATURE_WALK_STRIDE < 0.1);
});
test("miniature rig preserves finite walking and seated geometry within office scale", () => {
  const look = OFFICE_LOOKS.find((l) => l.id === "office-eun")!;
  const actor = createMiniatureActor("pilot", look, 0);
  for (const [walking, seated] of [
    [false, false],
    [true, false],
    [false, true],
    [true, false],
  ]) {
    actor.update(1.4, walking, "idle", seated);
    actor.root.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(actor.root);
    assert.ok(Number.isFinite(box.min.y) && Number.isFinite(box.max.y));
    assert.ok(box.max.y < 2.1 && box.min.y > -0.12);
    assert.equal(actor.root.userData.actorId, "pilot");
  }
});
