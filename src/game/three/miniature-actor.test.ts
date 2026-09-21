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

// ---------------------------------------------------------------------------
// 뛰기 — 에셋에 달리기 클립이 없으니 절차적으로 만든다

test("뛸 때는 온몸이 바라보는 쪽으로 기운다 — 머리도 함께 앞으로 간다", () => {
  const actor = createMiniatureActor("runner", OFFICE_LOOKS[0], 0);
  const headZ = (running: boolean) => {
    actor.update(0.3, true, "idle", false, undefined, { running, cadence: running ? 2 : 1 });
    actor.root.updateMatrixWorld(true);
    // 가장 높이 있는 부품이 머리다.
    let top = -Infinity;
    let z = 0;
    actor.rig.traverse((node) => {
      const p = node.getWorldPosition(new T.Vector3());
      if (p.y > top) {
        top = p.y;
        z = p.z;
      }
    });
    return z;
  };
  const walkZ = headZ(false);
  const runZ = headZ(true);
  // 바라보는 쪽은 +z 다. 몸통만 기울이면 머리는 제자리라 이 차이가 0 이 된다.
  assert.ok(
    runZ - walkZ > 0.1,
    `머리가 앞으로 가지 않았습니다: ${walkZ.toFixed(3)} → ${runZ.toFixed(3)}`,
  );
});

test("걷다가 멈추면 기울임이 사라진다", () => {
  const actor = createMiniatureActor("stop", OFFICE_LOOKS[0], 0);
  actor.update(0.3, true, "idle", false, undefined, { running: true, cadence: 2 });
  assert.ok(actor.rig.rotation.x > 0);
  actor.update(0.4, false, "idle", false, undefined, { running: false, cadence: 1 });
  assert.equal(actor.rig.rotation.x, 0);
});

test("뛸 때 걸음 주기가 빨라진다 — 같은 시간에 다리가 더 많이 돈다", () => {
  const legAngles = (running: boolean) => {
    const actor = createMiniatureActor("cadence", OFFICE_LOOKS[0], 0);
    const leg = actor.rig.children.find((c) => c.position.y === 0.89 && c.position.x < 0)!;
    const angles: number[] = [];
    // 1초면 한두 주기라 부호 전환 수가 거칠다. 3초를 센다.
    for (let i = 0; i < 180; i++) {
      actor.update(i / 60, true, "idle", false, undefined, { running, cadence: running ? 2 : 1 });
      angles.push(leg.rotation.x);
    }
    let crossings = 0;
    for (let i = 1; i < angles.length; i++)
      if (Math.sign(angles[i]) !== Math.sign(angles[i - 1])) crossings++;
    return crossings;
  };
  assert.ok(legAngles(true) >= legAngles(false) * 1.8, `${legAngles(false)} → ${legAngles(true)}`);
});
