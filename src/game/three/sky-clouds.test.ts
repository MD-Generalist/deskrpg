import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";

import { addCloudLights, buildCloud, cloudPuffs } from "./sky-clouds";

test("구름은 덩어리 여러 개가 가로로 퍼져 뭉게구름 실루엣을 만든다", () => {
  for (const variant of [0, 1, 2] as const) {
    const puffs = cloudPuffs(variant);
    assert.ok(puffs.length >= 5, "덩어리가 적으면 타원 두 개처럼 보인다");
    const box = new T.Box3().setFromObject(buildCloud(variant));
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    assert.ok(width / height > 1.8, `가로로 퍼지지 않았다(${width / height})`);
  }
});

test("같은 씨앗은 같은 구름을 준다 — 화면과 굽는 스크립트가 어긋나지 않는다", () => {
  assert.deepEqual(cloudPuffs(1), cloudPuffs(1));
  assert.notDeepEqual(cloudPuffs(0), cloudPuffs(2));
});

test("구름 조명은 위 흰빛·아래 하늘빛 두 개다", () => {
  const scene = new T.Scene();
  addCloudLights(scene);
  assert.equal(scene.children.filter((c) => c instanceof T.Light).length, 2);
});
