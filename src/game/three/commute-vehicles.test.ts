import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { createCommuteMaterials } from "./commute-materials";
import { createCommuteMotion } from "./commute-motion";
import { createCommuteVehicles } from "./commute-vehicles";

test("glazing contrasts with paint and passenger windscreens rake inward toward roof", () => {
  const palette = createCommuteMaterials();
  const fleet = createCommuteVehicles(palette);
  const luminance = (c: T.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  for (const vehicle of fleet.vehicles) {
    assert.ok(luminance(vehicle.materials[1].color) < luminance(vehicle.materials[0].color) * 0.45);
    if (!["sedan", "taxi", "suv"].includes(vehicle.kind)) continue;
    const glass = vehicle.root.children.find(
      (o) => o instanceof T.Mesh && o.material === vehicle.materials[1],
    ) as T.Mesh;
    const vertices = glass.geometry.attributes.position;
    const belt = vehicle.kind === "suv" ? 0.88 : 0.71;
    const roof = vehicle.kind === "suv" ? 1.62 : 1.35;
    const low: number[] = [],
      high: number[] = [];
    for (let i = 0; i < vertices.count; i++) {
      // Rounded boxes keep face vertices near their edges, not at face centers.
      // Include windscreen edges while excluding the outboard mirror glazing.
      if (Math.abs(vertices.getZ(i)) > 0.6) continue;
      if (vertices.getY(i) < belt + 0.15) low.push(vertices.getX(i));
      if (vertices.getY(i) > roof - 0.25) high.push(vertices.getX(i));
    }
    assert.ok(Math.max(...low) - Math.max(...high) > 0.12, "front windscreen slopes back");
    assert.ok(Math.min(...high) - Math.min(...low) > 0.12, "rear windscreen slopes forward");
  }
  fleet.dispose();
  palette.dispose();
});

for (const quality of ["desktop", "light"] as const) {
  test(`${quality}: six correctly sized vehicles, five silhouettes and forward orientation`, () => {
    const palette = createCommuteMaterials({ quality });
    const motion = createCommuteMotion();
    const fleet = createCommuteVehicles(palette, { quality });
    assert.equal(fleet.vehicles.length, 6);
    assert.equal(new Set(fleet.vehicles.map((v) => v.kind)).size, 5);
    const heights = new Map<string, number>();
    for (const [i, vehicle] of fleet.vehicles.entries()) {
      const state = motion.vehicles[i];
      const bounds = new T.Box3().setFromObject(vehicle.root);
      heights.set(vehicle.kind, bounds.max.y - bounds.min.y);
      assert.ok(Math.abs(bounds.max.x - bounds.min.x - state.length) < 1e-5);
      assert.ok(Math.abs(bounds.min.y) < 1e-5);
      assert.equal(vehicle.wheels.length, 4);
      for (const wheel of vehicle.wheels) {
        assert.equal(wheel.position.y, state.wheelRadius);
        const tire = wheel.children[0] as T.Mesh;
        tire.geometry.computeBoundingBox();
        assert.ok(Math.abs(tire.geometry.boundingBox!.max.x - state.wheelRadius) < 1e-6);
      }
      let meshes = 0;
      vehicle.root.traverse((o) => {
        if (o instanceof T.Mesh) meshes++;
      });
      assert.ok(meshes <= 20, `draw budget: ${meshes}`);
    }
    // Same-color replacements still fail: the five actual roof silhouettes differ.
    assert.equal(new Set([...heights.values()].map((h) => h.toFixed(3))).size, 5);
    assert.ok(heights.get("sedan")! < heights.get("taxi")!);
    assert.ok(heights.get("taxi")! < heights.get("suv")!);
    assert.ok(heights.get("suv")! < heights.get("van")!);
    assert.ok(heights.get("van")! < heights.get("bus")!);
    fleet.update(motion.vehicles);
    for (const [i, vehicle] of fleet.vehicles.entries()) {
      const front = new T.Vector3(1, 0, 0).applyQuaternion(vehicle.root.quaternion);
      assert.ok(Math.abs(front.x - motion.vehicles[i].direction) < 1e-8);
    }
    fleet.dispose();
    palette.dispose();
  });
}

test("travel drives rolling, stops freeze wheels, fades and disposal are isolated", () => {
  const palette = createCommuteMaterials();
  const fleet = createCommuteVehicles(palette);
  const motion = createCommuteMotion();
  motion.step(1);
  fleet.update(motion.vehicles);
  for (const [i, vehicle] of fleet.vehicles.entries()) {
    assert.equal(
      vehicle.wheels[0].rotation.z,
      -motion.vehicles[i].cumulativeDistance / motion.vehicles[i].wheelRadius,
    );
  }
  const rotation = fleet.vehicles[0].wheels[0].rotation.z;
  motion.step(2, false);
  fleet.update(motion.vehicles);
  assert.equal(fleet.vehicles[0].wheels[0].rotation.z, rotation);
  const first = fleet.vehicles[0],
    second = fleet.vehicles[1];
  const otherOpacity = second.materials[0].opacity;
  first.update({ ...motion.vehicles[0], opacity: 0, active: false });
  assert.equal(first.root.visible, false);
  assert.equal(second.materials[0].opacity, otherOpacity);
  first.update({ ...motion.vehicles[0], opacity: 0.4, active: true });
  assert.equal(first.root.visible, true);
  assert.ok(first.materials.every((m) => m.opacity === 0.4));
  let borrowedDisposals = 0,
    ownDisposals = 0;
  const geometryDisposals = new Map<T.BufferGeometry, number>();
  first.root.traverse((object) => {
    if (!(object instanceof T.Mesh) || geometryDisposals.has(object.geometry)) return;
    const geometry = object.geometry as T.BufferGeometry;
    geometryDisposals.set(geometry, 0);
    geometry.addEventListener("dispose", () =>
      geometryDisposals.set(geometry, geometryDisposals.get(geometry)! + 1),
    );
  });
  palette.materials.vehiclePaint.addEventListener("dispose", () => borrowedDisposals++);
  first.materials[0].addEventListener("dispose", () => ownDisposals++);
  first.dispose();
  first.dispose();
  assert.equal(ownDisposals, 1);
  assert.equal(borrowedDisposals, 0);
  assert.ok([...geometryDisposals.values()].every((count) => count === 1));
  assert.ok(second.root.children.length > 0);
  fleet.dispose();
  palette.dispose();
});

test("traffic-light stationary state freezes wheel angle over advancing time", () => {
  const palette = createCommuteMaterials();
  const fleet = createCommuteVehicles(palette);
  const motion = createCommuteMotion();
  motion.step(14);
  fleet.update(motion.vehicles);
  const stopped = motion.vehicles.findIndex((v) => v.active && v.speed === 0);
  assert.ok(stopped >= 0, "a vehicle is waiting at red");
  const angle = fleet.vehicles[stopped].wheels[0].rotation.z;
  motion.step(0.5);
  fleet.update(motion.vehicles);
  assert.equal(fleet.vehicles[stopped].wheels[0].rotation.z, angle);
  fleet.dispose();
  palette.dispose();
});
