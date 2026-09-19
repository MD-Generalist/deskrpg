import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";

import { addOfficeBuildingLights, buildOfficeBuilding } from "./office-building";

test("본사 모델은 지면 위에 서고, 나무는 끌 수 있다(마크용)", () => {
  const withTrees = buildOfficeBuilding();
  const bare = buildOfficeBuilding({ trees: false });
  assert.ok(withTrees.children.length > bare.children.length, "나무가 빠지지 않았다");
  const box = new T.Box3().setFromObject(bare);
  assert.ok(box.min.y >= -0.05, "모델이 지면 아래로 내려갔다");
  assert.ok(box.max.y > 2.5, "탑이 너무 낮다");
  // 마크는 정사각 안에 들어가야 한다 — 가로가 지나치게 넓으면 16px 에서 뭉갠다.
  assert.ok(box.max.x - box.min.x < 3.4, "나무를 뺀 폭이 너무 넓다");
});

test("조명은 화면과 마크가 같은 것을 쓴다", () => {
  const scene = new T.Scene();
  const sun = addOfficeBuildingLights(scene);
  assert.equal(sun.castShadow, true);
  assert.equal(scene.children.filter((c) => c instanceof T.Light).length, 2);
});
