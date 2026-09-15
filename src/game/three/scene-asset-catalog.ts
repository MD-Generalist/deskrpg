import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeletonTree } from "three/addons/utils/SkeletonUtils.js";
import { disposeTree } from "./dispose-tree";

export type SceneAssetFallback =
  | "plant"
  | "tree"
  | "backdrop-building"
  | "executive-desk"
  | "desk"
  | "chair"
  | "bookcase"
  | "rug"
  | "guest-chair"
  | "sofa"
  | "armchair"
  | "conference"
  | "coffee";

export type SceneMaterialSlot =
  "upholstery" | "painted-metal" | "oak" | "walnut" | "leather" | "glass" | "foliage" | "planter";

export type SceneAssetBounds = {
  units: "meters";
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

export type SceneAssetDestinationTag =
  | "photo"
  | "work"
  | "desk"
  | "ideation"
  | "collaboration"
  | "lounge"
  | "sofa"
  | "production"
  | "worktable"
  | "meeting"
  | "pantry"
  | "stool";

export type SceneAssetLocalCoordinates = {
  units: "meters";
  upAxis: "+Y";
  frontAxis: "+Z";
  origin: "ground-center";
};

export const SCENE_ASSET_LOCAL_COORDINATES = Object.freeze({
  units: "meters",
  upAxis: "+Y",
  frontAxis: "+Z",
  origin: "ground-center",
}) satisfies SceneAssetLocalCoordinates;

const APPROVED_DESTINATION_TAGS = new Set<SceneAssetDestinationTag>([
  "photo",
  "work",
  "desk",
  "ideation",
  "collaboration",
  "lounge",
  "sofa",
  "production",
  "worktable",
  "meeting",
  "pantry",
  "stool",
]);
const NO_DESTINATION_TAGS = Object.freeze([]) as readonly SceneAssetDestinationTag[];

export type SceneAssetDefinition = {
  url: string;
  category: "architecture" | "furniture" | "decor" | "landscape" | "kit";
  tags: readonly string[];
  destinationTags: readonly SceneAssetDestinationTag[];
  localCoordinates: SceneAssetLocalCoordinates;
  /** Integer tile-space collision/navigation footprint. */
  footprint: readonly [number, number];
  /** Authored model bounds, independent of the logical tile footprint. */
  bounds: SceneAssetBounds;
  maxHeight: number;
  fallback: SceneAssetFallback;
  materialSlots?: Readonly<Partial<Record<SceneMaterialSlot, string>>>;
  variants?: Readonly<Record<string, Readonly<Partial<Record<SceneMaterialSlot, `#${string}`>>>>>;
  seats?: readonly {
    anchor: readonly [number, number];
    visual: readonly [number, number, number];
    direction: "up" | "down" | "left" | "right";
  }[];
  shadows: { cast: boolean; receive: boolean };
  batch: "none" | "static" | "instance";
  lod: "hero" | "standard" | "small";
  budget: { maxTriangles: number; maxBytes: number; exception?: string };
  source: string;
  license: "repository-original";
};

type AssetRegistration = Omit<
  SceneAssetDefinition,
  "url" | "category" | "source" | "license" | "bounds" | "destinationTags" | "localCoordinates"
>;

function worldBounds(width: number, height: number, depth: number, minY = 0): SceneAssetBounds {
  return {
    units: "meters",
    min: [-width / 2, minY, -depth / 2],
    max: [width / 2, height, depth / 2],
  };
}

const executive = (
  name: string,
  bounds: SceneAssetBounds,
  definition: AssetRegistration,
): SceneAssetDefinition => ({
  ...definition,
  bounds,
  destinationTags: NO_DESTINATION_TAGS,
  localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  url: `/assets/furniture/executive/${name}-v1.glb`,
  category: "furniture",
  source: "scripts/assets/build-executive-furniture.py; original DeskRPG asset",
  license: "repository-original",
});

const landscape = (
  name: string,
  bounds: SceneAssetBounds,
  definition: AssetRegistration,
): SceneAssetDefinition => ({
  ...definition,
  bounds,
  destinationTags: NO_DESTINATION_TAGS,
  localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  url: `/assets/shared/landscape/${name}-v1.glb`,
  category: "landscape",
  source: "scripts/assets/build-shared-landscape.py; original DeskRPG asset",
  license: "repository-original",
});

const furnitureDefaults = {
  shadows: { cast: true, receive: true },
  batch: "static",
} as const;

export const SCENE_ASSETS = {
  "shared-ficus": landscape("ficus", worldBounds(0.65, 1.45, 0.57), {
    tags: ["plant", "indoor", "planter"],
    footprint: [1, 1],
    maxHeight: 1.7,
    fallback: "plant",
    shadows: { cast: true, receive: true },
    batch: "none",
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "shared-olive": landscape("olive", worldBounds(0.62, 1.45, 0.64), {
    tags: ["plant", "indoor", "planter"],
    footprint: [1, 1],
    maxHeight: 1.7,
    fallback: "plant",
    shadows: { cast: true, receive: true },
    batch: "none",
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "shared-street-tree": landscape("street-tree", worldBounds(3.44, 3.58, 3.33, -0.06), {
    tags: ["tree", "exterior", "streetscape"],
    footprint: [4, 4],
    maxHeight: 4,
    fallback: "tree",
    shadows: { cast: true, receive: true },
    batch: "none",
    lod: "hero",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "shared-glass-tower": landscape("glass-tower", worldBounds(1.46, 7.7, 1.28), {
    tags: ["building", "exterior", "backdrop"],
    footprint: [2, 2],
    maxHeight: 8,
    fallback: "backdrop-building",
    shadows: { cast: false, receive: true },
    batch: "static",
    lod: "small",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "shared-stone-tower": landscape("stone-tower", worldBounds(1.46, 6.31, 1.28), {
    tags: ["building", "exterior", "backdrop"],
    footprint: [2, 2],
    maxHeight: 7,
    fallback: "backdrop-building",
    shadows: { cast: false, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "executive-desk": executive("executive-desk", worldBounds(3.91, 1.49, 1.91), {
    tags: ["desk", "executive", "workstation"],
    footprint: [4, 2],
    maxHeight: 1.5,
    fallback: "executive-desk",
    ...furnitureDefaults,
    lod: "hero",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "executive-work-desk": executive("desk", worldBounds(1.95, 1.27, 0.93), {
    tags: ["desk", "executive", "workstation"],
    footprint: [2, 1],
    maxHeight: 1.3,
    fallback: "desk",
    ...furnitureDefaults,
    lod: "hero",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "executive-office-chair": executive("chair", worldBounds(0.7, 1.31, 0.76), {
    tags: ["chair", "executive", "seat"],
    footprint: [1, 1],
    maxHeight: 1.4,
    fallback: "chair",
    seats: [{ anchor: [0, 0], visual: [0, 0.48, 0], direction: "up" }],
    ...furnitureDefaults,
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "executive-bookcase": executive("bookcase", worldBounds(1, 3.34, 0.88), {
    tags: ["storage", "executive", "bookcase"],
    footprint: [1, 1],
    maxHeight: 3.4,
    fallback: "bookcase",
    ...furnitureDefaults,
    lod: "hero",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "executive-rug": executive("rug", worldBounds(5.91, 0.04, 5.91), {
    tags: ["rug", "executive", "decor"],
    footprint: [6, 6],
    maxHeight: 0.05,
    fallback: "rug",
    shadows: { cast: false, receive: true },
    batch: "static",
    lod: "small",
    budget: { maxTriangles: 3_000, maxBytes: 2_000_000 },
  }),
  "executive-guest-chair": executive("guest-chair", worldBounds(0.67, 1.1, 0.72), {
    tags: ["chair", "executive", "seat"],
    footprint: [1, 1],
    maxHeight: 1.2,
    fallback: "guest-chair",
    seats: [{ anchor: [0, 0], visual: [0, 0.46, 0], direction: "up" }],
    ...furnitureDefaults,
    lod: "small",
    budget: { maxTriangles: 3_000, maxBytes: 2_000_000 },
  }),
  "shared-side-chair": executive("guest-chair", worldBounds(0.67, 1.1, 0.72), {
    tags: ["chair", "shared", "seat"],
    footprint: [1, 1],
    maxHeight: 1.2,
    fallback: "guest-chair",
    materialSlots: { upholstery: "Cream linen" },
    variants: {
      "off-white": { upholstery: "#e7dfd1" },
      teal: { upholstery: "#377f7b" },
      coral: { upholstery: "#c96f5d" },
      mustard: { upholstery: "#c49542" },
      neutral: { upholstery: "#9b9184" },
    },
    seats: [{ anchor: [0, 0], visual: [0, 0.46, 0], direction: "up" }],
    ...furnitureDefaults,
    lod: "small",
    budget: { maxTriangles: 3_000, maxBytes: 2_000_000 },
  }),
  "executive-sofa": executive("sofa", worldBounds(1.81, 0.97, 0.81), {
    tags: ["sofa", "executive", "seat"],
    footprint: [2, 1],
    maxHeight: 1.1,
    fallback: "sofa",
    ...furnitureDefaults,
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "executive-armchair": executive("armchair", worldBounds(0.91, 0.97, 0.81), {
    tags: ["armchair", "executive", "seat"],
    footprint: [1, 1],
    maxHeight: 1.1,
    fallback: "armchair",
    ...furnitureDefaults,
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
  "executive-conference-table": executive("conference", worldBounds(3.74, 1.32, 1.83), {
    tags: ["table", "executive", "meeting"],
    footprint: [4, 2],
    maxHeight: 1.4,
    fallback: "conference",
    ...furnitureDefaults,
    lod: "hero",
    budget: { maxTriangles: 30_000, maxBytes: 2_000_000 },
  }),
  "executive-coffee-table": executive("coffee", worldBounds(1.8, 0.9, 1.8), {
    tags: ["table", "executive", "lounge"],
    footprint: [2, 2],
    maxHeight: 1,
    fallback: "coffee",
    ...furnitureDefaults,
    lod: "standard",
    budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  }),
} as const satisfies Record<string, SceneAssetDefinition>;

export type SceneAssetId = keyof typeof SCENE_ASSETS;

export function validateSceneAssetCatalog(assets: Readonly<Record<string, SceneAssetDefinition>>) {
  for (const [id, asset] of Object.entries(assets)) {
    if (!/-v\d+\.glb$/.test(asset.url)) throw new Error(`Versioned URL required for ${id}`);
    if (asset.footprint.some((dimension) => !Number.isInteger(dimension) || dimension <= 0)) {
      throw new Error(`Invalid footprint for ${id}`);
    }
    if (
      asset.bounds.units !== "meters" ||
      asset.bounds.min.some((value) => !Number.isFinite(value)) ||
      asset.bounds.max.some((value) => !Number.isFinite(value)) ||
      asset.bounds.max.some((value, axis) => value <= asset.bounds.min[axis]) ||
      asset.maxHeight < asset.bounds.max[1]
    ) {
      throw new Error(`Invalid world bounds for ${id}`);
    }
    if (!asset.fallback) throw new Error(`Fallback required for ${id}`);
    if (!asset.source || !asset.license) throw new Error(`Source metadata required for ${id}`);
    if (
      asset.localCoordinates.units !== "meters" ||
      asset.localCoordinates.upAxis !== "+Y" ||
      asset.localCoordinates.frontAxis !== "+Z" ||
      asset.localCoordinates.origin !== "ground-center"
    ) {
      throw new Error(`Invalid coordinate convention for ${id}`);
    }
    if (
      asset.destinationTags.some((tag) => !APPROVED_DESTINATION_TAGS.has(tag)) ||
      new Set(asset.destinationTags).size !== asset.destinationTags.length
    ) {
      throw new Error(`Invalid destination tag for ${id}`);
    }
    if (
      asset.seats?.some((seat) => seat.anchor.some((coordinate) => !Number.isInteger(coordinate)))
    ) {
      throw new Error(`Invalid seat anchor for ${id}`);
    }
    if (
      asset.budget.maxTriangles <= 0 ||
      asset.budget.maxBytes <= 0 ||
      (asset.budget.maxBytes > 2_000_000 && !asset.budget.exception)
    ) {
      throw new Error(`Invalid budget for ${id}`);
    }
    for (const [variantName, variant] of Object.entries(asset.variants ?? {})) {
      for (const slot of Object.keys(variant)) {
        if (!asset.materialSlots?.[slot as SceneMaterialSlot]) {
          throw new Error(`Unknown material slot ${slot} in ${id}:${variantName}`);
        }
      }
    }
  }
}

validateSceneAssetCatalog(SCENE_ASSETS);

export function sceneAsset(id: SceneAssetId): SceneAssetDefinition {
  return SCENE_ASSETS[id];
}

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
