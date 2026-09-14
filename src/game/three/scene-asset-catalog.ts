import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeletonTree } from "three/addons/utils/SkeletonUtils.js";
import { disposeTree } from "./dispose-tree";

export * from "./scene-asset-definitions";
import {
  sceneAsset,
  type SceneAssetDefinition,
  type SceneAssetId,
  type SceneMaterialSlot,
} from "./scene-asset-definitions";

export type SceneAssetLoader = (url: string) => Promise<T.Object3D>;

export type AttachSceneAssetOptions = {
  load?: SceneAssetLoader;
  variant?: string;
  anisotropy?: number;
  environmentIntensity?: number;
  normalScale?: number;
};

const defaultLoader: SceneAssetLoader = async (url) =>
  (await new GLTFLoader().loadAsync(url)).scene;
const sourceCaches = new WeakMap<SceneAssetLoader, Map<string, Promise<T.Object3D>>>();

type HostAssetState = {
  disposed: boolean;
  generation: number;
};
const hostAssetStates = new WeakMap<T.Group, HostAssetState>();

function cachedSource(load: SceneAssetLoader, url: string) {
  let cache = sourceCaches.get(load);
  if (!cache) {
    cache = new Map();
    sourceCaches.set(load, cache);
  }
  const found = cache.get(url);
  if (found) return found;
  let loaded: Promise<T.Object3D>;
  try {
    loaded = Promise.resolve(load(url));
  } catch (error) {
    loaded = Promise.reject(error);
  }
  const pending = loaded.catch((error) => {
    if (cache?.get(url) === pending) cache.delete(url);
    throw error;
  });
  cache.set(url, pending);
  return pending;
}

/** Clone every disposable resource so each host can use ordinary disposeTree(). */
function cloneSceneAsset(source: T.Object3D) {
  const model = cloneSkeletonTree(source);
  const geometries = new Map<T.BufferGeometry, T.BufferGeometry>();
  const materials = new Map<T.Material, T.Material>();
  const textures = new Map<T.Texture, T.Texture>();
  const copyMaterial = (sourceMaterial: T.Material) => {
    const found = materials.get(sourceMaterial);
    if (found) return found;
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
  model.traverse((object) => {
    if (!(object instanceof T.Mesh) && !(object instanceof T.Line)) return;
    const sourceGeometry = object.geometry;
    let geometry = geometries.get(sourceGeometry);
    if (!geometry) {
      const copiedGeometry: T.BufferGeometry = sourceGeometry.clone();
      geometries.set(sourceGeometry, copiedGeometry);
      geometry = copiedGeometry;
    }
    object.geometry = geometry;
    object.material = Array.isArray(object.material)
      ? object.material.map(copyMaterial)
      : copyMaterial(object.material);
  });
  return model;
}

function stateFor(host: T.Group): HostAssetState {
  const existing = hostAssetStates.get(host);
  if (existing) return existing;
  const previousDispose = host.userData.disposeActor;
  const state: HostAssetState = { disposed: false, generation: 0 };
  hostAssetStates.set(host, state);
  host.userData.disposeActor = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.generation += 1;
    if (typeof previousDispose === "function") previousDispose();
  };
  return state;
}

function prepareInstance(
  model: T.Object3D,
  definition: SceneAssetDefinition,
  options: AttachSceneAssetOptions,
) {
  const variant = options.variant ? definition.variants?.[options.variant] : undefined;
  if (options.variant && !variant) throw new Error(`Unknown asset variant: ${options.variant}`);
  const replacements = new Map<string, `#${string}`>();
  if (variant) {
    for (const [slot, value] of Object.entries(variant)) {
      const materialName = definition.materialSlots?.[slot as SceneMaterialSlot];
      if (!materialName || !value) throw new Error(`Unknown material slot: ${slot}`);
      replacements.set(materialName, value);
    }
  }
  model.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    object.castShadow = definition.shadows.cast;
    object.receiveShadow = definition.shadows.receive;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      material.envMapIntensity = options.environmentIntensity ?? 0.55;
      if (material.normalMap) material.normalScale.multiplyScalar(options.normalScale ?? 0.12);
      const replacement = replacements.get(material.name);
      if (replacement) material.color.set(replacement);
      for (const value of Object.values(material)) {
        if (value instanceof T.Texture) value.anisotropy = options.anisotropy ?? 4;
      }
    }
  });
}

/**
 * Cached GLB sources live for the module lifetime. Hosts receive deep resource
 * clones, so disposing a host cannot invalidate the cache or a sibling host.
 */
export function attachSceneAsset(
  host: T.Group,
  id: SceneAssetId,
  options: AttachSceneAssetOptions = {},
) {
  const definition = sceneAsset(id);
  host.userData.sceneAssetUrl = definition.url;
  const state = stateFor(host);
  if (state.disposed) return Promise.resolve(false);
  const generation = ++state.generation;
  const fallback = [...host.children];
  const load = options.load ?? defaultLoader;
  host.userData.dynamicAsset = true;
  host.userData.assetStatus = "loading";
  const ready = cachedSource(load, definition.url)
    .then((source) => {
      if (state.disposed || generation !== state.generation) return false;
      const model = cloneSceneAsset(source);
      try {
        prepareInstance(model, definition, options);
      } catch (error) {
        disposeTree(model);
        throw error;
      }
      if (state.disposed || generation !== state.generation) {
        disposeTree(model);
        return false;
      }
      for (const object of fallback) {
        host.remove(object);
        disposeTree(object);
      }
      host.add(model);
      host.userData.assetStatus = "ready";
      return true;
    })
    .catch(() => {
      if (!state.disposed && generation === state.generation) {
        host.userData.assetStatus = "failed";
      }
      return false;
    });
  host.userData.assetReady = ready;
  return ready;
}
