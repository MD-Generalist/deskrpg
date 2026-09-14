import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { batchStaticFurniture } from "./static-batching";
import { disposeTree } from "./office-renderer";
test("batching preserves bounds, keeps chairs raycastable and retained materials alive", () => {
  const root = new T.Group(),
    material = new T.MeshStandardMaterial({ color: "#aabbcc" });
  let disposed = 0;
  material.addEventListener("dispose", () => disposed++);
  for (let i = 0; i < 4; i++) {
    const g = new T.Group();
    g.position.x = i * 2;
    root.add(g);
    g.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), material));
  }
  const chair = new T.Group();
  chair.userData.seat = { x: 0, z: 1 };
  chair.position.z = 3;
  root.add(chair);
  const seat = new T.Mesh(new T.BoxGeometry(1, 1, 1), material);
  chair.add(seat);
  const before = new T.Box3().setFromObject(root);
  batchStaticFurniture(root);
  const after = new T.Box3().setFromObject(root);
  assert.ok(before.equals(after));
  assert.equal(seat.parent, chair);
  assert.equal(disposed, 0);
  let meshes = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh) meshes++;
  });
  assert.equal(meshes, 2);
  disposeTree(root);
  assert.equal(disposed, 1);
});

test("scene batching preserves palette and exact invisible seat picking without visible seat draws", () => {
  const root = new T.Group();
  const colors = ["#aa3311", "#22aa44"];
  const seats = colors.map((color, index) => {
    const group = new T.Group();
    group.position.set(index * 3, 0, 0);
    group.userData.seat = { x: index * 3, z: 0 };
    const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color }));
    mesh.castShadow = true;
    group.add(mesh);
    root.add(group);
    return { group, mesh };
  });
  batchStaticFurniture(root, true, { vertexColors: true, batchSeats: true });
  const rendered: T.Mesh[] = [];
  root.traverseVisible((object) => {
    if (object instanceof T.Mesh) rendered.push(object);
  });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].castShadow, true);
  const batchMaterial = rendered[0].material as T.MeshStandardMaterial;
  assert.equal(batchMaterial.vertexColors, true);
  assert.equal(batchMaterial.color.getHex(), 0xffffff);
  const attribute = rendered[0].geometry.getAttribute("color");
  const red = new T.Color(colors[0]),
    green = new T.Color(colors[1]);
  assert.ok(Math.abs(attribute.getX(0) - red.r) < 1e-6);
  assert.ok(Math.abs(attribute.getY(attribute.count - 1) - green.g) < 1e-6);
  for (const { group, mesh } of seats) {
    assert.equal(mesh.parent, group);
    assert.equal(mesh.visible, false);
    const ray = new T.Raycaster(new T.Vector3(group.position.x, 2, 0), new T.Vector3(0, -1, 0));
    const hit = ray.intersectObject(root, true).find((hit) => hit.object.parent?.userData.seat);
    assert.equal(
      hit?.object,
      mesh,
      "invisible exact proxy remains selectable at each original seat",
    );
  }
  disposeTree(root);
});

import { batchCoplanarGlass } from "./static-batching";
test("glass batches along a plane while separate walls and optical properties remain distinct", () => {
  const root = new T.Group();
  for (const z of [0, 3])
    for (const x of [0, 2, 4]) {
      const pane = new T.Mesh(
        new T.BoxGeometry(1.9, 2, 0.035),
        new T.MeshStandardMaterial({ transparent: true, opacity: 0.14, depthWrite: false }),
      );
      pane.position.set(x, 1, z);
      pane.userData.staticGlass = true;
      root.add(pane);
    }
  const before = new T.Box3().setFromObject(root);
  batchCoplanarGlass(root);
  assert.equal(root.children.length, 2);
  const after = new T.Box3().setFromObject(root);
  assert.ok(before.min.distanceTo(after.min) < 1e-6);
  assert.ok(before.max.distanceTo(after.max) < 1e-6);
  for (const child of root.children) {
    const material = (child as T.Mesh).material as T.MeshStandardMaterial;
    assert.equal(material.opacity, 0.14);
    assert.equal(material.depthWrite, false);
    assert.equal((child as T.Mesh).castShadow, false);
  }
  disposeTree(root);
});

test("hidden ancestor furniture stays hidden after batching", () => {
  const root = new T.Group();
  const hidden = new T.Group();
  hidden.visible = false;
  root.add(hidden);
  for (let i = 0; i < 2; i++)
    hidden.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  batchStaticFurniture(root, true);
  let visible = 0;
  root.traverseVisible((object) => {
    if (object instanceof T.Mesh) visible++;
  });
  assert.equal(visible, 0);
  disposeTree(root);
});

test("mirrored front faces remain visible and raycastable", () => {
  const root = new T.Group();
  for (const x of [-2, 2]) {
    const mesh = new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial());
    mesh.position.x = x;
    mesh.scale.x = -1;
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  const rays = [-2, 2].map((x) => new T.Raycaster(new T.Vector3(x, 0, 2), new T.Vector3(0, 0, -1)));
  assert.ok(rays.every((ray) => ray.intersectObject(root, true).length > 0));
  batchStaticFurniture(root, true);
  root.updateMatrixWorld(true);
  assert.ok(rays.every((ray) => ray.intersectObject(root, true).length > 0));
  disposeTree(root);
});

test("different normal maps and physical coating cannot collapse into one material", () => {
  const root = new T.Group();
  const texture = new T.Texture();
  const a = new T.MeshPhysicalMaterial({ clearcoat: 0.1, normalMap: texture });
  const b = new T.MeshPhysicalMaterial({ clearcoat: 0.9 });
  root.add(new T.Mesh(new T.BoxGeometry(), a), new T.Mesh(new T.BoxGeometry(), b));
  batchStaticFurniture(root, true, { vertexColors: true });
  assert.equal(root.children.length, 2);
  assert.equal((root.children[0] as T.Mesh).material, a);
  assert.equal((root.children[1] as T.Mesh).material, b);
  disposeTree(root);
});

test("angled glass and different coating roughness retain separate transparent draws", () => {
  const root = new T.Group();
  for (let i = 0; i < 3; i++) {
    const pane = new T.Mesh(
      new T.BoxGeometry(1, 2, 0.03),
      new T.MeshPhysicalMaterial({
        transparent: true,
        opacity: 0.2,
        clearcoat: 1,
        clearcoatRoughness: i === 2 ? 0.8 : 0.1,
      }),
    );
    pane.position.x = i * 2;
    pane.rotation.y = i === 1 ? Math.PI / 6 : 0;
    pane.userData.staticGlass = true;
    root.add(pane);
  }
  batchCoplanarGlass(root);
  assert.equal(root.children.length, 3);
  disposeTree(root);
});

test("repeat batching retains proxies and disposes shared resources exactly once on teardown", () => {
  const root = new T.Group();
  const geometry = new T.BoxGeometry();
  const texture = new T.Texture();
  const material = new T.MeshStandardMaterial({ map: texture });
  for (let i = 0; i < 2; i++) {
    const owner = new T.Group();
    owner.position.x = i * 2;
    owner.userData.seat = { x: i * 2, z: 0 };
    owner.add(new T.Mesh(geometry, material));
    root.add(owner);
  }
  batchStaticFurniture(root, true, { vertexColors: true, batchSeats: true });
  const resources = new Set<T.BufferGeometry | T.Material | T.Texture>([texture]);
  root.traverse((object) => {
    if (object instanceof T.Mesh) {
      resources.add(object.geometry);
      resources.add(object.material as T.Material);
    }
  });
  const disposals = new Map<object, number>();
  for (const resource of resources)
    resource.addEventListener("dispose", () =>
      disposals.set(resource, (disposals.get(resource) ?? 0) + 1),
    );
  batchStaticFurniture(root, true, { vertexColors: true, batchSeats: true });
  assert.equal(disposals.size, 0);
  const ray = new T.Raycaster(new T.Vector3(0, 2, 0), new T.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(root, true).some((hit) => hit.object.userData.seatPickProxy));
  disposeTree(root);
  assert.equal(disposals.size, resources.size);
  for (const count of disposals.values()) assert.equal(count, 1);
});
