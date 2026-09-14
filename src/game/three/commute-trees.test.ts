import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { createCommuteMaterials } from "./commute-materials";
import { createCommuteTree } from "./commute-trees";

test("tree seeds reproduce branches and leaves and vary between trees", () => {
  const palette = createCommuteMaterials();
  const a = createCommuteTree(palette, { seed: 42 });
  const b = createCommuteTree(palette, { seed: 42 });
  const c = createCommuteTree(palette, { seed: 43 });
  assert.deepEqual(a.leaves.instanceMatrix.array, b.leaves.instanceMatrix.array);
  assert.deepEqual(
    a.branches.geometry.attributes.position.array,
    b.branches.geometry.attributes.position.array,
  );
  assert.notDeepEqual(a.leaves.instanceMatrix.array, c.leaves.instanceMatrix.array);
  for (const tree of [a, b, c]) tree.dispose();
  palette.dispose();
});

test("both qualities retain airy individual leaves, varied orientations and bounded geometry", () => {
  const palette = createCommuteMaterials();
  const counts: number[] = [];
  for (const quality of ["desktop", "light"] as const) {
    const tree = createCommuteTree(palette, { quality });
    counts.push(tree.leaves.count);
    assert.equal(tree.group.children.length, 2);
    assert.ok(tree.leaves.count >= 120);
    assert.equal(tree.leaves.geometry.attributes.position.count, 9);
    assert.ok(tree.branches.geometry.attributes.position.count > 100);
    const triangles =
      tree.branches.geometry.index!.count / 3 +
      (tree.leaves.geometry.index!.count / 3) * tree.leaves.count;
    assert.ok(triangles < 6500, String(triangles));
    const normals = new Set<string>();
    const matrix = new T.Matrix4();
    const center = new T.Vector3();
    let clearCore = 0;
    for (let i = 0; i < tree.leaves.count; i++) {
      tree.leaves.getMatrixAt(i, matrix);
      const normal = new T.Vector3(0, 0, 1).transformDirection(matrix);
      normals.add(
        `${Math.round(normal.x * 2)},${Math.round(normal.y * 2)},${Math.round(normal.z * 2)}`,
      );
      center.setFromMatrixPosition(matrix);
      assert.ok(center.y > 1.65 && center.y < 3.5);
      if (Math.hypot(center.x, center.z) < 0.2) clearCore++;
    }
    assert.ok(normals.size > 25);
    assert.ok(clearCore < tree.leaves.count * 0.2);
    assert.ok(new Set(tree.leaves.instanceColor!.array).size > 20);
    assert.equal(tree.leaves.material, palette.materials.leaf);
    assert.equal(tree.leaves.customDepthMaterial, palette.leafDepthMaterial);
    assert.equal(tree.leaves.customDistanceMaterial, palette.leafDistanceMaterial);
    tree.dispose();
  }
  assert.ok(counts[1] < counts[0]);
  palette.dispose();
});

test("size scales whole tree and disposal is idempotent without disposing borrowed resources", () => {
  const palette = createCommuteMaterials();
  let borrowedDisposals = 0;
  for (const resource of [
    ...Object.values(palette.materials),
    ...palette.textures,
    palette.leafDepthMaterial,
    palette.leafDistanceMaterial,
  ]) {
    resource.addEventListener("dispose", () => borrowedDisposals++);
  }
  for (let i = 0; i < 3; i++) {
    const tree = createCommuteTree(palette, { size: 1.25 });
    assert.equal(tree.group.scale.x, 1.25);
    let geometryDisposals = 0;
    tree.branches.geometry.addEventListener("dispose", () => geometryDisposals++);
    tree.leaves.geometry.addEventListener("dispose", () => geometryDisposals++);
    let instanceDisposals = 0;
    tree.leaves.addEventListener("dispose", () => instanceDisposals++);
    tree.dispose();
    tree.dispose();
    assert.equal(geometryDisposals, 2);
    assert.equal(instanceDisposals, 1);
    assert.equal(tree.group.children.length, 0);
  }
  assert.equal(borrowedDisposals, 0);
  palette.dispose();
  assert.ok(borrowedDisposals > 0);
});
