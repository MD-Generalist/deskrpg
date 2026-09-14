import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { createCommuteCity } from "./commute-city";
import { createActor } from "./characters";

test("city composes six distance walkers, six vehicles and ten trees; pause preserves pose", (t) => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ getContext: () => null }) },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "document"));
  const updates: unknown[][] = [];
  let disposals = 0;
  const actorFactory = (() => ({
    root: new T.Group(),
    rig: new T.Group(),
    ring: new T.Mesh(),
    ready: Promise.resolve(true),
    update: (...args: unknown[]) => updates.push(args),
    dispose: () => {
      disposals++;
    },
  })) as unknown as typeof createActor;
  for (const quality of ["desktop", "light"] as const) {
    const city = createCommuteCity({ quality, actorFactory });
    assert.equal(city.root.children.filter((o) => o.name === "commute-tree").length, 10);
    const fleet = city.root.getObjectByName("commute-vehicles")!;
    assert.equal(fleet.children.length, 6);
    const initialPositions = fleet.children.map((o) => o.position.x);
    city.update(0, true);
    city.update(1, true);
    const positions = fleet.children.map((o) => o.position.x);
    assert.notDeepEqual(positions, initialPositions);
    const calls = updates.length;
    city.update(100, false);
    assert.equal(updates.length, calls);
    assert.deepEqual(
      fleet.children.map((o) => o.position.x),
      positions,
    );
    city.update(100.1, true);
    assert.equal(updates.at(-1)?.[2], "walking");
    assert.ok((updates.at(-1)?.[4] as { cumulativeDistance: number }).cumulativeDistance < 2);
    const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
    city.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        resources.add(o.geometry);
        for (const m of [
          ...(Array.isArray(o.material) ? o.material : [o.material]),
          o.customDepthMaterial,
          o.customDistanceMaterial,
        ]) {
          if (!m) continue;
          resources.add(m);
          for (const value of Object.values(m))
            if (value instanceof T.Texture) resources.add(value);
        }
      }
    });
    const counts = new Map<object, number>();
    for (const resource of resources)
      resource.addEventListener("dispose", () =>
        counts.set(resource, (counts.get(resource) ?? 0) + 1),
      );
    city.dispose();
    city.dispose();
    assert.equal(counts.size, resources.size);
    for (const resource of resources) assert.equal(counts.get(resource), 1);
    const after = updates.length;
    city.update(200, true);
    assert.equal(updates.length, after);
    assert.equal(city.root.children.length, 0);
  }
  assert.equal(disposals, 12);
});

test("quality replacement preserves actors and paused traffic; late readiness samples fixed gait only while alive", async (t) => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ getContext: () => null }) },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "document"));
  let resolve!: (value: boolean) => void;
  const ready = new Promise<boolean>((r) => {
    resolve = r;
  });
  const updates: unknown[][] = [];
  const actors: T.Group[] = [];
  const actorFactory = (() => {
    const root = new T.Group();
    actors.push(root);
    return {
      root,
      rig: new T.Group(),
      ring: new T.Mesh(),
      ready,
      update: (...args: unknown[]) => updates.push(args),
      dispose() {},
    };
  }) as unknown as typeof createActor;
  const city = createCommuteCity({ actorFactory });
  city.update(0, false);
  assert.equal(updates.length, 6);
  const fleet = city.root.getObjectByName("commute-vehicles")!;
  const positions = fleet.children.map((o) => o.position.toArray());
  city.setQuality("light");
  assert.equal(actors.length, 6);
  assert.equal(fleet.parent, null);
  assert.deepEqual(
    city.root.getObjectByName("commute-vehicles")!.children.map((o) => o.position.toArray()),
    positions,
  );
  resolve(true);
  await city.ready;
  assert.equal(updates.length, 12);
  assert.ok(
    updates.every(
      (args) =>
        args[1] === true &&
        args[2] === "walking" &&
        (args[4] as { cumulativeDistance: number }).cumulativeDistance === 0,
    ),
  );
  city.dispose();
  const late = createCommuteCity({ actorFactory });
  late.dispose();
  await late.ready;
  assert.equal(updates.length, 12);
  assert.equal(late.root.children.length, 0);
});
