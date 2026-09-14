import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SHARED_SCENE_ASSETS } from "./shared-scene-assets";
import { attachSceneAsset } from "./furniture-asset";
import { disposeTree } from "./dispose-tree";

for (const [name, asset] of Object.entries(SHARED_SCENE_ASSETS)) {
  test(`${name}: registered shared model fits its bounds and geometry budget`, async () => {
    const bytes = await readFile(`public${asset.url}`);
    assert.ok(bytes.length < 2_000_000);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { scene } = await new GLTFLoader().parseAsync(data, "");
    const bounds = new T.Box3().setFromObject(scene);
    const size = bounds.getSize(new T.Vector3());
    assert.ok(
      size.x <= asset.footprint[0] && size.z <= asset.footprint[1],
      size.toArray().join(","),
    );
    assert.ok(bounds.max.y <= asset.maxHeight && bounds.min.y >= -0.06);
    let triangles = 0;
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      assert.ok(object.geometry.attributes.normal);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials)
        assert.equal(material.transparent, false, "no alpha-card sorting");
    });
    assert.ok(triangles > 500 && triangles < 60_000, `${triangles} triangles`);
    disposeTree(scene);
  });
}

test("shared loader resolves catalogue URL and distant towers do not darken the office", async () => {
  const host = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  await attachSceneAsset(host, "glass-tower", async (url) => {
    assert.equal(url, SHARED_SCENE_ASSETS["glass-tower"].url);
    return new T.Group().add(mesh);
  });
  assert.equal(mesh.castShadow, false);
  assert.equal(host.userData.assetStatus, "ready");
  disposeTree(host);
});
