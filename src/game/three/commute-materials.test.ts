import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createCommuteMaterials } from "./commute-materials";

test("miniature surfaces retain distinct optical responses and correctly encoded maps", () => {
  const palette = createCommuteMaterials();
  const m = palette.materials;
  assert.ok(m.asphalt.roughness > m.paving.roughness);
  assert.ok(m.rubber.roughness > m.vehiclePaint.roughness);
  assert.ok(m.glass.roughness < m.vehiclePaint.roughness);
  assert.ok(m.metal.metalness > 0.7);
  assert.equal(m.facade.metalness, 0);
  for (const name of ["asphalt", "paving", "facade", "wood", "bark"] as const) {
    assert.ok(m[name].map);
    assert.equal(m[name].map!.colorSpace, T.SRGBColorSpace);
    assert.ok(m[name].bumpMap);
    assert.equal(m[name].bumpMap!.colorSpace, T.NoColorSpace);
    assert.notEqual(m[name].map, m[name].bumpMap);
  }
  assert.equal(m.glass.transparent, false, "opaque reflective miniature glazing avoids sorting");
  palette.dispose();
});

test("seeded texture generation is repeatable and light quality reduces memory", () => {
  const a = createCommuteMaterials({ seed: 37 });
  const b = createCommuteMaterials({ seed: 37 });
  const c = createCommuteMaterials({ seed: 38 });
  const light = createCommuteMaterials({ seed: 37, quality: "light" });
  assert.deepEqual(
    a.textures.map((t) => t.image.data),
    b.textures.map((t) => t.image.data),
  );
  assert.notDeepEqual(a.materials.asphalt.map!.image.data, c.materials.asphalt.map!.image.data);
  const bytes = (textures: readonly T.DataTexture[]) =>
    textures.reduce((sum, texture) => sum + texture.image.data.byteLength, 0);
  assert.ok(bytes(light.textures) < bytes(a.textures));
  assert.equal(light.materials.facade.bumpMap, null);
  assert.ok(light.materials.leaf.map, "leaf cutouts survive quality reduction");
  for (const palette of [a, b, c, light]) palette.dispose();
});

test("leaf pixels form a pointed silhouette with matching visible and shadow cutouts", () => {
  const palette = createCommuteMaterials();
  const leaf = palette.materials.leaf;
  const map = leaf.map as T.DataTexture;
  const size = map.image.width;
  const alpha = (x: number, y: number) => map.image.data[(y * size + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(size - 1, size - 1), 0);
  assert.equal(alpha(size >> 1, size >> 1), 255);
  const opaqueAt = (y: number) => {
    let count = 0;
    for (let x = 0; x < size; x++) if (alpha(x, y) > 127) count++;
    return count;
  };
  assert.ok(opaqueAt(size >> 1) > opaqueAt(2) * 3);
  assert.ok(opaqueAt(size >> 1) > opaqueAt(size - 3) * 3);
  assert.ok(opaqueAt(size >> 1) < size);
  for (const material of [leaf, palette.leafDepthMaterial, palette.leafDistanceMaterial]) {
    assert.equal(material.map, map);
    assert.ok(material.alphaTest >= 0.4);
    assert.equal(material.alphaTest, leaf.alphaTest);
    assert.equal(material.side, T.DoubleSide);
  }
  assert.equal(leaf.transparent, false);
  palette.dispose();
});

test("palette owns clones and shared textures and disposes every resource exactly once", () => {
  const palette = createCommuteMaterials();
  const clone = palette.clone("vehiclePaint", "#e8c486");
  const wood = palette.clone("wood", "#b9966e");
  assert.notEqual(clone, palette.materials.vehiclePaint);
  assert.equal(clone.color.getHexString(), "e8c486");
  assert.equal(wood.map, palette.materials.wood.map);
  assert.notEqual(wood.color.getHexString(), palette.materials.wood.color.getHexString());
  const resources = new Set<T.Material | T.Texture>([
    ...Object.values(palette.materials),
    ...palette.textures,
    palette.leafDepthMaterial,
    palette.leafDistanceMaterial,
    clone,
    wood,
  ]);
  const disposals = new Map<T.Material | T.Texture, number>();
  for (const resource of resources)
    resource.addEventListener("dispose", () =>
      disposals.set(resource, (disposals.get(resource) ?? 0) + 1),
    );
  palette.dispose();
  palette.dispose();
  assert.equal(disposals.size, resources.size);
  assert.ok([...disposals.values()].every((count) => count === 1));
  assert.throws(() => palette.clone("wood"), /disposed/i);
});
