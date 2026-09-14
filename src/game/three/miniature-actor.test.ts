import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createMiniatureActor } from "./miniature-actor";
import { OFFICE_LOOKS } from "./office-looks";
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
