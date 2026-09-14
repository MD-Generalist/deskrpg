import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeTree } from "./dispose-tree";

for (const [name, width, depth, height] of [
  ["desk", 2.01, 1.01, 1.3],
  ["chair", 0.8, 0.8, 1.4],
  ["bookcase", 1.01, 1.01, 3.4],
  ["rug", 6, 6, 0.05],
  ["guest-chair", 0.8, 0.8, 1.2],
  ["sofa", 1.9, 0.84, 1.1],
  ["armchair", 1, 0.84, 1.1],
  ["conference", 4, 2, 1.4],
  ["coffee", 2, 2, 1],
] as const) {
  test(`${name} GLB fits the existing footprint and embeds its PBR maps`, async () => {
    const bytes = await readFile(`public/assets/furniture/executive/${name}-v1.glb`);
    assert.equal(bytes.toString("utf8", 0, 4), "glTF");
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length < 3_000_000, "per-asset download budget");
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(json.images.length >= 3);
    for (const image of json.images) {
      assert.equal(image.uri, undefined);
      assert.equal(image.mimeType, "image/webp");
      assert.ok(Number.isInteger(image.bufferView));
    }
    assert.ok(
      json.materials.some(
        (m: {
          normalTexture?: unknown;
          pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown };
        }) => m.normalTexture && m.pbrMetallicRoughness?.metallicRoughnessTexture,
      ),
    );
    // Exercise the production GLTF geometry decoder; Node has no image decoder.
    const loader = new GLTFLoader();
    loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new T.Texture() }));
    const gltf = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const bounds = new T.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new T.Vector3());
    assert.ok(size.x <= width && size.z <= depth && size.y <= height, `${name}: ${size.toArray()}`);
    assert.ok(bounds.min.y >= -0.001, "asset does not extend below floor");
    gltf.scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      assert.ok(object.geometry.attributes.normal);
      assert.ok(object.geometry.attributes.uv);
    });
    disposeTree(gltf.scene);
  });
}
