import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as T from "three";
import {
  buildPublishingAsset,
  PUBLISHING_ASSETS,
  renderPublishingObject,
} from "./publishing-assets";
import { SCENE_ASSETS } from "./scene-asset-definitions";
import { getObjectDimensions } from "../../lib/object-types";
import { disposeTree } from "./dispose-tree";

test("출판 집기는 이동 점유 영역과 높이 계약 안에 머문다", () => {
  for (const id of Object.keys(PUBLISHING_ASSETS) as (keyof typeof PUBLISHING_ASSETS)[]) {
    const d = PUBLISHING_ASSETS[id],
      root = buildPublishingAsset(id),
      b = new T.Box3().setFromObject(root);
    const dimensions = getObjectDimensions(d.type, "down");
    assert.deepEqual(d.footprint, [dimensions.width, dimensions.height]);
    assert.ok(b.max.x - b.min.x <= d.footprint[0] + 0.001, id);
    assert.ok(b.max.z - b.min.z <= d.footprint[1] + 0.001, id);
    assert.ok(b.max.y <= d.height + 0.001, id);
    disposeTree(root);
  }
});
test("출판 GLB의 카탈로그 치수·해시·PBR 텍스처가 실제 파일과 일치한다", async () => {
  const report = JSON.parse(
    await readFile("public/assets/shared/publishing/build-report.json", "utf8"),
  );
  for (const id of Object.keys(PUBLISHING_ASSETS) as (keyof typeof PUBLISHING_ASSETS)[]) {
    const actual = report[id],
      definition = SCENE_ASSETS[id],
      bytes = await readFile("public" + definition.url);
    assert.equal(bytes.length, actual.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), actual.sha256);
    assert.deepEqual(definition.bounds?.min, actual.bounds.min);
    assert.deepEqual(definition.bounds?.max, actual.bounds.max);
    assert.ok(actual.triangles <= definition.budget.maxTriangles);
    assert.ok(bytes.length <= definition.budget.maxBytes);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(
      gltf.materials.some(
        (m: { normalTexture?: unknown; pbrMetallicRoughness?: { baseColorTexture?: unknown } }) =>
          m.normalTexture && m.pbrMetallicRoughness?.baseColorTexture,
      ),
      id,
    );
  }
});

// 출력대의 회전된 메시와 논리 점유가 같은 면적을 사용한다.
test("출력대는 방향별 점유 영역 안에서 회전한다", () => {
  for (const direction of ["down", "right", "up", "left"] as const) {
    const host = new T.Group();
    const object = {
      id: "print",
      type: "studio_shelf" as const,
      col: 5,
      row: 6,
      direction,
      variant: "pub-print-bench",
    };
    assert.ok(renderPublishingObject(host, object));
    const bounds = new T.Box3().setFromObject(host);
    const size = getObjectDimensions(object.type, direction);
    assert.ok(bounds.min.x >= 5 - 0.001);
    assert.ok(bounds.max.x <= 5 + size.width + 0.001);
    assert.ok(bounds.min.z >= 6 - 0.001);
    assert.ok(bounds.max.z <= 6 + size.height + 0.001);
    disposeTree(host);
  }
});
