import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { disposeTree } from "./office-renderer";
import { createActor } from "./characters";
test("renderer teardown disposes shared GPU resources once and releases instanced buffers", () => {
  const root = new T.Group(),
    geometry = new T.BoxGeometry(),
    texture = new T.Texture(),
    material = new T.MeshStandardMaterial({ map: texture });
  const counts = { geometry: 0, texture: 0, material: 0, instances: 0 };
  geometry.addEventListener("dispose", () => counts.geometry++);
  texture.addEventListener("dispose", () => counts.texture++);
  material.addEventListener("dispose", () => counts.material++);
  const instances = new T.InstancedMesh(geometry, material, 2);
  instances.addEventListener("dispose", () => counts.instances++);
  root.add(new T.Mesh(geometry, material), new T.Mesh(geometry, material), instances);
  disposeTree(root);
  assert.deepEqual(counts, { geometry: 1, texture: 1, material: 1, instances: 1 });
  assert.equal(root.children.length, 0);
});
test("MVP human rig walks and reacts without changing authoritative root coordinates", () => {
  const actor = createActor("profile-real-id", "#667788", 0, {
    skin: "#ab8866",
    hair: "#222222",
    legs: "#443322",
  });
  actor.root.position.set(3.5, 0, 5.5);
  for (const phase of ["walking", "thinking", "streaming", "idle"] as const)
    actor.update(4, phase === "walking", phase, false);
  assert.deepEqual(actor.root.position.toArray(), [3.5, 0, 5.5]);
  assert.equal(actor.root.userData.actorId, "profile-real-id");
  const box = new T.Box3().setFromObject(actor.root);
  assert.ok(Number.isFinite(box.max.y));
  assert.ok(box.max.y - box.min.y > 1);
  disposeTree(actor.root);
});
