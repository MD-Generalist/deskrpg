import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";

import { createActor } from "./characters";

/** 외형 없는 옛 절차적 캐릭터 — 렌더러가 이 리그의 y 회전으로 방향을 준다. */
function headPosition(yaw: number, running: boolean) {
  const actor = createActor("legacy", "#667788", 0);
  actor.rig.rotation.y = yaw; // 렌더러가 하는 일
  actor.update(0.3, true, "idle", false, undefined, { running, cadence: running ? 2 : 1 });
  actor.root.updateMatrixWorld(true);
  let top = -Infinity;
  const at = new T.Vector3();
  actor.rig.traverse((node) => {
    const p = node.getWorldPosition(new T.Vector3());
    if (p.y > top) {
      top = p.y;
      at.copy(p);
    }
  });
  return at;
}

test("뛸 때 바라보는 쪽으로 기운다 — 아래(+z)를 보면 머리가 +z 로", () => {
  const run = headPosition(0, true);
  const walk = headPosition(0, false);
  assert.ok(run.z - walk.z > 0.1, `${walk.z.toFixed(3)} → ${run.z.toFixed(3)}`);
});

test("오른쪽(+x)을 봐도 오른쪽으로 기운다 — 기울임이 방향보다 먼저 적용된다", () => {
  // 오일러 기본 순서(XYZ)면 기울임이 월드 x 축으로 걸려, 옆을 볼 때 머리가 옆이 아니라 +z 로 간다.
  const run = headPosition(Math.PI / 2, true);
  const walk = headPosition(Math.PI / 2, false);
  assert.ok(
    run.x - walk.x > 0.1,
    `오른쪽으로 기울지 않았습니다: x ${walk.x.toFixed(3)} → ${run.x.toFixed(3)}`,
  );
  assert.ok(
    Math.abs(run.z - walk.z) < 0.05,
    `엉뚱하게 z 로 기울었습니다: ${(run.z - walk.z).toFixed(3)}`,
  );
});
