import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeTree } from "./dispose-tree";
import {
  SCENE_ASSETS,
  attachSceneAsset,
  sceneAsset,
  validateSceneAssetCatalog,
} from "./scene-asset-catalog";

test("every asset has a versioned URL, footprint, fallback and budget", () => {
  for (const [id, asset] of Object.entries(SCENE_ASSETS)) {
    assert.match(asset.url, /-v\d+\.glb$/);
    assert.ok(asset.footprint[0] > 0 && asset.footprint[1] > 0, id);
    assert.equal(asset.bounds.units, "meters", id);
    assert.ok(asset.bounds.max[0] > asset.bounds.min[0], id);
    assert.ok(asset.bounds.max[2] > asset.bounds.min[2], id);
    assert.deepEqual(asset.localCoordinates, {
      units: "meters",
      upAxis: "+Y",
      frontAxis: "+Z",
      origin: "ground-center",
    });
    assert.ok(Array.isArray(asset.destinationTags), id);
    assert.equal(new Set(asset.destinationTags).size, asset.destinationTags.length, id);
    assert.ok(asset.fallback, id);
    assert.ok(asset.source, id);
    assert.equal(asset.license, "repository-original", id);
    assert.ok(asset.budget.maxBytes <= 2_000_000 || asset.budget.exception, id);
  }
});

test("seat variants declare navigation and visual transforms separately", () => {
  const chair = sceneAsset("shared-side-chair");
  assert.deepEqual(chair.seats?.[0].anchor, [0, 0]);
  assert.deepEqual(chair.seats?.[0].visual, [0, 0.46, 0]);
  for (const asset of Object.values(SCENE_ASSETS)) {
    for (const seat of asset.seats ?? []) {
      assert.ok(seat.anchor.every(Number.isInteger), "navigation anchors use logical tiles");
    }
  }
});

test("catalog validation rejects malformed metadata before a loader can consume it", () => {
  const invalid = {
    ...SCENE_ASSETS,
    "shared-ficus": { ...SCENE_ASSETS["shared-ficus"], footprint: [0, 1] as const },
  };
  assert.throws(() => validateSceneAssetCatalog(invalid), /footprint.*shared-ficus/i);

  const invalidDestination = {
    ...SCENE_ASSETS,
    "shared-ficus": {
      ...SCENE_ASSETS["shared-ficus"],
      destinationTags: ["unapproved"],
    },
  };
  assert.throws(
    () => validateSceneAssetCatalog(invalidDestination as typeof SCENE_ASSETS),
    /destination tag.*shared-ficus/i,
  );

  const invalidOrigin = {
    ...SCENE_ASSETS,
    "shared-ficus": {
      ...SCENE_ASSETS["shared-ficus"],
      localCoordinates: {
        ...SCENE_ASSETS["shared-ficus"].localCoordinates,
        origin: "model-center",
      },
    },
  };
  assert.throws(
    () => validateSceneAssetCatalog(invalidOrigin as typeof SCENE_ASSETS),
    /coordinate convention.*shared-ficus/i,
  );

  const invalidSeat = {
    ...SCENE_ASSETS,
    "shared-side-chair": {
      ...SCENE_ASSETS["shared-side-chair"],
      seats: [{ anchor: [0, 0.5], visual: [0, 0.46, 0], direction: "up" }],
    },
  };
  assert.throws(
    () => validateSceneAssetCatalog(invalidSeat as unknown as typeof SCENE_ASSETS),
    /seat anchor.*shared-side-chair/i,
  );
});

test("registered files fit their world bounds, triangle and byte budgets", async () => {
  for (const [id, asset] of Object.entries(SCENE_ASSETS)) {
    const bytes = await readFile(`public${asset.url}`);
    assert.ok(
      bytes.length <= asset.budget.maxBytes || asset.budget.exception,
      `${id}: ${bytes.length} bytes`,
    );
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: "EXT_texture_webp",
      loadTexture: async () => new T.Texture(),
    }));
    const gltf = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const bounds = new T.Box3().setFromObject(gltf.scene);
    const epsilon = 0.001;
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(bounds.min.getComponent(axis) >= asset.bounds.min[axis] - epsilon, id);
      assert.ok(bounds.max.getComponent(axis) <= asset.bounds.max[axis] + epsilon, id);
    }
    let triangles = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });
    assert.ok(triangles <= asset.budget.maxTriangles, `${id}: ${triangles} triangles`);
    disposeTree(gltf.scene);
  }
});

test("one source load per URL produces independently owned host clones", async () => {
  let loadCalls = 0;
  const sourceGeometry = new T.BoxGeometry();
  const sourceTexture = new T.Texture();
  const sourceMaterial = new T.MeshStandardMaterial({ map: sourceTexture });
  const source = new T.Group().add(new T.Mesh(sourceGeometry, sourceMaterial));
  const load = async () => {
    loadCalls += 1;
    return source;
  };
  const first = new T.Group();
  const second = new T.Group();

  assert.equal(await attachSceneAsset(first, "shared-ficus", { load }), true);
  assert.equal(await attachSceneAsset(second, "shared-ficus", { load }), true);
  assert.equal(loadCalls, 1);
  const firstMesh = first.children[0].children[0] as T.Mesh;
  const secondMesh = second.children[0].children[0] as T.Mesh;
  assert.notEqual(first.children[0], second.children[0]);
  assert.notEqual(firstMesh.geometry, secondMesh.geometry);
  assert.notEqual(firstMesh.material, secondMesh.material);
  assert.notEqual(
    (firstMesh.material as T.MeshStandardMaterial).map,
    (secondMesh.material as T.MeshStandardMaterial).map,
  );

  let secondGeometryFreed = false;
  secondMesh.geometry.addEventListener("dispose", () => {
    secondGeometryFreed = true;
  });
  disposeTree(first);
  assert.equal(secondGeometryFreed, false);
  disposeTree(second);
  disposeTree(source);
});

test("line primitives receive independently disposable geometry and materials", async () => {
  const sourceGeometry = new T.BufferGeometry().setFromPoints([
    new T.Vector3(0, 0, 0),
    new T.Vector3(1, 0, 0),
  ]);
  const sourceMaterial = new T.LineBasicMaterial({ color: "#ffffff" });
  const source = new T.Group().add(new T.LineSegments(sourceGeometry, sourceMaterial));
  const load = async () => source;
  const first = new T.Group();
  const second = new T.Group();

  assert.equal(await attachSceneAsset(first, "shared-ficus", { load }), true);
  assert.equal(await attachSceneAsset(second, "shared-ficus", { load }), true);
  const firstLine = first.children[0].children[0] as T.LineSegments;
  const secondLine = second.children[0].children[0] as T.LineSegments;
  assert.notEqual(firstLine.geometry, secondLine.geometry);
  assert.notEqual(firstLine.material, secondLine.material);

  let secondGeometryDisposals = 0;
  secondLine.geometry.addEventListener("dispose", () => {
    secondGeometryDisposals += 1;
  });
  disposeTree(first);
  assert.equal(secondGeometryDisposals, 0);
  disposeTree(second);
  assert.equal(secondGeometryDisposals, 1);
  disposeTree(source);
});

test("catalog policy and an explicit material variant apply only to the clone", async () => {
  const sourceMaterial = new T.MeshStandardMaterial({ color: "#ffffff" });
  sourceMaterial.name = "Cream linen";
  sourceMaterial.normalMap = new T.Texture();
  const source = new T.Group().add(new T.Mesh(new T.BoxGeometry(), sourceMaterial));
  const host = new T.Group();

  await attachSceneAsset(host, "shared-side-chair", {
    variant: "teal",
    load: async () => source,
  });

  const mesh = host.children[0].children[0] as T.Mesh;
  const material = mesh.material as T.MeshStandardMaterial;
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
  assert.equal(material.color.getHexString(), "377f7b");
  assert.equal(material.envMapIntensity, 0.55);
  assert.deepEqual(material.normalScale.toArray(), [0.12, 0.12]);
  assert.equal(material.normalMap?.anisotropy, 4);
  assert.equal(sourceMaterial.color.getHexString(), "ffffff");
  disposeTree(host);
  disposeTree(source);
});

test("simultaneous variants share the pending source without sharing materials", async () => {
  let loadCalls = 0;
  let finish!: (model: T.Group) => void;
  const load = () => {
    loadCalls += 1;
    return new Promise<T.Group>((resolve) => {
      finish = resolve;
    });
  };
  const tealHost = new T.Group();
  const coralHost = new T.Group();
  const tealReady = attachSceneAsset(tealHost, "shared-side-chair", { variant: "teal", load });
  const coralReady = attachSceneAsset(coralHost, "shared-side-chair", {
    variant: "coral",
    load,
  });
  const material = new T.MeshStandardMaterial();
  material.name = "Cream linen";
  const source = new T.Group().add(new T.Mesh(new T.BoxGeometry(), material));
  finish(source);

  assert.deepEqual(await Promise.all([tealReady, coralReady]), [true, true]);
  assert.equal(loadCalls, 1);
  const teal = (tealHost.children[0].children[0] as T.Mesh).material as T.MeshStandardMaterial;
  const coral = (coralHost.children[0].children[0] as T.Mesh).material as T.MeshStandardMaterial;
  assert.equal(teal.color.getHexString(), "377f7b");
  assert.equal(coral.color.getHexString(), "c96f5d");
  assert.notEqual(teal, coral);
  disposeTree(tealHost);
  disposeTree(coralHost);
  disposeTree(source);
});

test("cancelling one pending host leaves a shared load available to a live host", async () => {
  let loadCalls = 0;
  let finish!: (model: T.Group) => void;
  const load = () => {
    loadCalls += 1;
    return new Promise<T.Group>((resolve) => {
      finish = resolve;
    });
  };
  const cancelledHost = new T.Group();
  const liveHost = new T.Group();
  let priorDisposals = 0;
  cancelledHost.userData.disposeActor = () => {
    priorDisposals += 1;
  };
  const cancelledReady = attachSceneAsset(cancelledHost, "shared-street-tree", { load });
  const liveReady = attachSceneAsset(liveHost, "shared-street-tree", { load });
  disposeTree(cancelledHost);
  const sourceGeometry = new T.BoxGeometry();
  const source = new T.Group().add(new T.Mesh(sourceGeometry, new T.MeshStandardMaterial()));
  let sourceDisposed = false;
  sourceGeometry.addEventListener("dispose", () => {
    sourceDisposed = true;
  });
  finish(source);

  assert.deepEqual(await Promise.all([cancelledReady, liveReady]), [false, true]);
  assert.equal(loadCalls, 1);
  assert.equal(priorDisposals, 1);
  assert.equal(sourceDisposed, false);
  assert.equal(liveHost.userData.assetStatus, "ready");
  disposeTree(liveHost);
  assert.equal(sourceDisposed, false);
  disposeTree(source);
});

test("a failed source load is evicted so the next attachment can retry", async () => {
  let loadCalls = 0;
  const source = new T.Group().add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  const load = async () => {
    loadCalls += 1;
    if (loadCalls === 1) throw new Error("temporary outage");
    return source;
  };
  const first = new T.Group().add(new T.Group());
  const second = new T.Group().add(new T.Group());

  assert.equal(await attachSceneAsset(first, "shared-glass-tower", { load }), false);
  assert.equal(await attachSceneAsset(second, "shared-glass-tower", { load }), true);
  assert.equal(loadCalls, 2);
  assert.equal(first.userData.assetStatus, "failed");
  assert.equal(second.userData.assetStatus, "ready");
  disposeTree(first);
  disposeTree(second);
  disposeTree(source);
});

test("repeated attachment supersedes the stale request and preserves the original disposer", async () => {
  const host = new T.Group().add(new T.Group());
  let priorDisposals = 0;
  host.userData.disposeActor = () => {
    priorDisposals += 1;
  };
  let finishFirst!: (model: T.Group) => void;
  let finishSecond!: (model: T.Group) => void;
  const first = attachSceneAsset(host, "shared-ficus", {
    load: () => new Promise((resolve) => (finishFirst = resolve)),
  });
  const second = attachSceneAsset(host, "shared-olive", {
    load: () => new Promise((resolve) => (finishSecond = resolve)),
  });
  const firstSource = new T.Group().add(
    new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()),
  );
  const secondSource = new T.Group().add(
    new T.Mesh(new T.SphereGeometry(), new T.MeshStandardMaterial()),
  );
  finishSecond(secondSource);
  assert.equal(await second, true);
  finishFirst(firstSource);
  assert.equal(await first, false);
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].children[0] instanceof T.Mesh, true);
  assert.equal(priorDisposals, 0);

  disposeTree(host);
  assert.equal(priorDisposals, 1);
  disposeTree(firstSource);
  disposeTree(secondSource);
});

test("failed and disposed hosts keep their procedural fallbacks", async () => {
  const failedHost = new T.Group();
  const failedFallback = new T.Group();
  failedHost.add(failedFallback);
  assert.equal(
    await attachSceneAsset(failedHost, "shared-olive", {
      load: async () => {
        throw new Error("offline");
      },
    }),
    false,
  );
  assert.equal(failedHost.children[0], failedFallback);
  assert.equal(failedHost.userData.assetStatus, "failed");

  const disposedHost = new T.Group();
  const disposedFallback = new T.Group();
  disposedHost.add(disposedFallback);
  let finish!: (model: T.Group) => void;
  const ready = attachSceneAsset(disposedHost, "shared-ficus", {
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  disposeTree(disposedHost);
  const late = new T.Group().add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  finish(late);
  assert.equal(await ready, false);
  assert.equal(disposedHost.children.length, 0);

  disposeTree(failedHost);
  disposeTree(late);
});
