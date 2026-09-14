import * as T from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ActorPhase } from "./characters";
import type { OfficeLook } from "./office-looks";
import { createMiniatureActor } from "./miniature-actor";
import { createGltfGestures } from "./gltf-gestures";

/** Assets use metres, +Z forward and floor origin; animation owns the pelvis height. */
export type ActorAssetLoader = (url: string) => Promise<GLTF>;
const defaultLoader: ActorAssetLoader = (url) => new GLTFLoader().loadAsync(url);
const caches = new WeakMap<ActorAssetLoader, Map<string, AssetEntry>>();
type AssetEntry = { promise: Promise<GLTF>; users: number; asset?: GLTF };

function disposeResources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const skeletons = new Set<T.Skeleton>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof T.SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof T.Texture) textures.add(value);
      }
    }
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  root.clear();
}

/** Independent resources allow ordinary scene disposal without breaking sibling actors. */
function cloneAsset(source: T.Object3D) {
  const model = clone(source);
  const geometries = new Map<T.BufferGeometry, T.BufferGeometry>();
  const materials = new Map<T.Material, T.Material>();
  const textures = new Map<T.Texture, T.Texture>();
  const copyMaterial = (sourceMaterial: T.Material) => {
    const existing = materials.get(sourceMaterial);
    if (existing) return existing;
    const material = sourceMaterial.clone();
    materials.set(sourceMaterial, material);
    for (const [key, value] of Object.entries(material)) {
      if (!(value instanceof T.Texture)) continue;
      let texture = textures.get(value);
      if (!texture) {
        texture = value.clone();
        textures.set(value, texture);
      }
      (material as unknown as Record<string, unknown>)[key] = texture;
    }
    return material;
  };
  model.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    let geometry = geometries.get(node.geometry);
    if (!geometry) {
      const copiedGeometry: T.BufferGeometry = node.geometry.clone();
      geometries.set(node.geometry, copiedGeometry);
      geometry = copiedGeometry;
    }
    node.geometry = geometry;
    node.material = Array.isArray(node.material)
      ? node.material.map(copyMaterial)
      : copyMaterial(node.material);
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return model;
}

export function createGltfActor(
  id: string,
  look: OfficeLook,
  index: number,
  url: string,
  load: ActorAssetLoader = defaultLoader,
) {
  const fallback = createMiniatureActor(id, look, index);
  const { root, rig, ring } = fallback;
  root.userData.modelStyle = "gltf";
  root.userData.assetStatus = "loading";
  let disposed = false;
  let mixer: T.AnimationMixer | undefined;
  let model: T.Object3D | undefined;
  let gestures: ReturnType<typeof createGltfGestures> | undefined;
  let current: T.AnimationAction | undefined;
  let lastTime: number | undefined;
  const actions = new Map<string, T.AnimationAction>();
  let cache = caches.get(load);
  if (!cache) caches.set(load, (cache = new Map()));
  let entry = cache.get(url);
  if (!entry) {
    entry = { promise: Promise.resolve().then(() => load(url)), users: 0 };
    cache.set(url, entry);
    const ownedEntry = entry;
    void entry.promise.then(
      (asset) => {
        ownedEntry.asset = asset;
      },
      () => {},
    );
  }
  entry.users++;
  const ownedEntry = entry;
  const release = () => {
    ownedEntry.users--;
    if (ownedEntry.users !== 0) return;
    if (cache.get(url) === ownedEntry) cache.delete(url);
    void ownedEntry.promise.then(
      (asset) => disposeResources(asset.scene),
      () => {},
    );
  };
  const ready = entry.promise
    .then((asset) => {
      if (disposed) return false;
      model = cloneAsset(asset.scene);
      mixer = new T.AnimationMixer(model);
      gestures = createGltfGestures(model, index);
      for (const clip of asset.animations)
        actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
      disposeResources(rig);
      rig.position.set(0, 0, 0);
      // Facing belongs to the caller (meeting seats set it only once before loading).
      rig.rotation.set(0, rig.rotation.y, 0);
      rig.add(model);
      root.userData.assetStatus = "ready";
      return true;
    })
    .catch((error: unknown) => {
      if (!disposed) {
        root.userData.assetStatus = "error";
        root.userData.assetError = error instanceof Error ? error.message : String(error);
      }
      return false;
    });

  const actor = {
    id,
    root,
    rig,
    ring,
    ready,
    phase: "idle" as ActorPhase,
    seated: false,
    update(t: number, walking: boolean, phase: ActorPhase, seated: boolean) {
      if (disposed) return;
      const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(0.1, t - lastTime));
      lastTime = t;
      actor.phase = phase;
      actor.seated = seated && !walking;
      if (!mixer) {
        fallback.update(t, walking, phase, seated);
        return;
      }
      const name = walking ? "walk" : seated ? "sit" : "idle";
      const next = actions.get(name) ?? actions.get("idle");
      if (next && next !== current) {
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        if (current) next.crossFadeFrom(current, 0.22, false);
        current = next;
      }
      gestures?.restore();
      mixer.update(delta);
      gestures?.apply(t, walking, phase);
      ring.material.opacity = phase === "streaming" ? 0.45 : 0.22;
    },
    /** Call before generic disposeTree(root), including entire renderer shutdown. */
    dispose() {
      if (disposed) return;
      disposed = true;
      gestures = undefined;
      mixer?.stopAllAction();
      if (model) mixer?.uncacheRoot(model);
      disposeResources(root);
      release();
      root.userData.assetStatus = "disposed";
    },
  };
  root.userData.disposeActor = actor.dispose;
  return actor;
}
