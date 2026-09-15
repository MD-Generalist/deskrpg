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
  | "coffee"
  | "architecture-panel"
  | "architecture-glass"
  | "studio-furniture"
  | "creative-studio-kit"
  | "tech-furniture"
  | "trading-furniture"
  | "publishing-furniture";

export type SceneMaterialSlot =
  | "upholstery"
  | "painted-metal"
  | "oak"
  | "walnut"
  | "leather"
  | "glass"
  | "foliage"
  | "planter"
  | "brick"
  | "plaster"
  | "paper"
  | "printed-paper"
  | "diffuser"
  | "coral"
  | "ceramic";

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
    /** Local pose X/Z plus physical cushion height Y; actor lift is separate. */
    visual: readonly [number, number, number];
    actorElevation?: number;
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

const architecture = (
  name: string,
  width: number,
  height: number,
  depth: number,
  glass = false,
): SceneAssetDefinition => ({
  url: `/assets/shared/architecture/${name}-v1.glb`,
  category: "architecture",
  tags: glass ? ["architecture", "glass", name] : ["architecture", name],
  destinationTags: NO_DESTINATION_TAGS,
  localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  footprint: [Math.ceil(width), Math.ceil(depth)],
  bounds: worldBounds(width, height, depth),
  maxHeight: height,
  fallback: glass ? "architecture-glass" : "architecture-panel",
  materialSlots: {
    oak: "oak",
    brick: "brick",
    plaster: "plaster",
    glass: "glass",
    "painted-metal": "painted-metal",
  },
  shadows: { cast: !glass, receive: true },
  batch: "static",
  lod: "standard",
  budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  source: "scripts/assets/build-creative-studio-architecture.py",
  license: "repository-original",
});

export const STUDIO_UPHOLSTERY_VARIANTS = {
  "off-white": { upholstery: "#e7dfd1" },
  blue: { upholstery: "#527ea3" },
  navy: { upholstery: "#263e59" },
  olive: { upholstery: "#737b60" },
  mint: { upholstery: "#9dbca8" },
  graphite: { upholstery: "#30383d" },
  teal: { upholstery: "#377f7b" },
  coral: { upholstery: "#c96f5d" },
  mustard: { upholstery: "#c49542" },
  neutral: { upholstery: "#9b9184" },
} as const;
const studioFurniture = (
  name: string,
  width: number,
  height: number,
  depth: number,
  footprint: readonly [number, number],
  options: Partial<SceneAssetDefinition> = {},
): SceneAssetDefinition => ({
  url: `/assets/shared/furniture/${name}-v1.glb`,
  category: "furniture",
  tags: ["shared", name],
  destinationTags: [],
  localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  footprint,
  bounds: worldBounds(width, height, depth),
  maxHeight: height,
  fallback: "studio-furniture",
  materialSlots: { oak: "oak", upholstery: "upholstery", "painted-metal": "painted-metal" },
  shadows: { cast: true, receive: true },
  batch: "static",
  lod: "standard",
  budget: { maxTriangles: 12_000, maxBytes: 2_000_000 },
  source: "scripts/assets/build-shared-studio-furniture.py",
  license: "repository-original",
  ...options,
});
const studioChairSeats = [
  { anchor: [0, 0], visual: [0, 0.46, 0], direction: "down", actorElevation: 0 },
] as const;
const studioSofaSeats = (curved = false): NonNullable<SceneAssetDefinition["seats"]> =>
  [0, 1, 2].map((i) => ({
    anchor: [i, 1],
    visual: [(i - 1) * 0.94, 0.53, curved ? (i === 1 ? 0.26 : 0.36) : 0.3],
    actorElevation: 0.055,
    direction: "down",
  }));

const studioKit = (
  name: string,
  folder: "photo" | "production" | "ideation" | "pantry",
  width: number,
  height: number,
  depth: number,
  footprint: readonly [number, number],
  slots: SceneAssetDefinition["materialSlots"],
  maxTriangles = 30_000,
): SceneAssetDefinition => ({
  url: `/assets/environments/creative-studio/${folder}/${name}-v1.glb`,
  category: "kit",
  tags: ["creative-studio", folder],
  destinationTags: [folder === "ideation" ? "ideation" : folder],
  localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  footprint,
  bounds: worldBounds(width, height, depth),
  maxHeight: height,
  fallback: "creative-studio-kit",
  materialSlots: slots,
  shadows: { cast: true, receive: true },
  batch: "static",
  lod: maxTriangles > 12_000 ? "hero" : "small",
  budget: { maxTriangles, maxBytes: 2_000_000 },
  source: "scripts/assets/build-creative-studio-kits.py; original DeskRPG art and geometry",
  license: "repository-original",
});

export const SCENE_ASSETS = {
  "pub-binding-bench": {
    url: "/assets/shared/publishing/pub-binding-bench-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-binding-bench"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9850000143051147, -1.0728836485895954e-8, -0.4749999940395355],
      max: [0.9850000143051147, 1.2000000476837158, 0.4754999876022339],
    },
    maxHeight: 1.2000000476837158,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-library": {
    url: "/assets/shared/publishing/pub-library-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-library"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, -4.7683716530855236e-8, -0.4675000011920929],
      max: [0.9900000095367432, 2.9000000953674316, 0.3675000071525574],
    },
    maxHeight: 2.9000000953674316,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-library-ladder": {
    url: "/assets/shared/publishing/pub-library-ladder-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-library-ladder"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, -4.7683716530855236e-8, -0.4675000011920929],
      max: [0.9900000095367432, 2.9000000953674316, 0.48249998688697815],
    },
    maxHeight: 2.9000000953674316,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-proof-desk": {
    url: "/assets/shared/publishing/pub-proof-desk-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-proof-desk"],
    destinationTags: [],
    footprint: [4, 1],
    bounds: {
      units: "meters",
      min: [-1.9800000190734863, -1.19209286886246e-9, -0.4749999940395355],
      max: [1.9800000190734863, 1.2103056907653809, 0.4749999940395355],
    },
    maxHeight: 1.2103056907653809,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-newbook-display": {
    url: "/assets/shared/publishing/pub-newbook-display-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-newbook-display"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9925000071525574, 3.5762786065873797e-9, -0.3400000035762787],
      max: [0.9925000071525574, 1.190000057220459, 0.3400000035762787],
    },
    maxHeight: 1.190000057220459,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-print-bench": {
    url: "/assets/shared/publishing/pub-print-bench-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-print-bench"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9850000143051147, -1.0728836485895954e-8, -0.4749999940395355],
      max: [0.9850000143051147, 1.3224999904632568, 0.47999998927116394],
    },
    maxHeight: 1.3224999904632568,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "pub-workstation": {
    url: "/assets/shared/publishing/pub-workstation-v1.glb",
    category: "furniture",
    tags: ["shared", "publishing", "pub-workstation"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, -1.0728836485895954e-8, -0.47999998927116394],
      max: [0.9900000095367432, 1.4082363843917847, 0.47999998927116394],
    },
    maxHeight: 1.4082363843917847,
    fallback: "publishing-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-publishing-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-round-table": {
    url: "/assets/shared/trading/trade-round-table-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-round-table"],
    destinationTags: [],
    footprint: [2, 2],
    bounds: {
      units: "meters",
      min: [-0.8500000238418579, 1.0728836485895954e-8, -0.8500000238418579],
      max: [0.8500000238418579, 0.8700000017881394, 0.8500000238418579],
    },
    maxHeight: 0.8700000017881394,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-square-table": {
    url: "/assets/shared/trading/trade-square-table-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-square-table"],
    destinationTags: [],
    footprint: [2, 2],
    bounds: {
      units: "meters",
      min: [-0.8600000143051147, 1.0728836485895954e-8, -0.8600000143051147],
      max: [0.8600000143051147, 0.8700000017881394, 0.8600000143051147],
    },
    maxHeight: 0.8700000017881394,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-coffee-table": {
    url: "/assets/shared/trading/trade-coffee-table-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-coffee-table"],
    destinationTags: [],
    footprint: [2, 2],
    bounds: {
      units: "meters",
      min: [-0.8500000238418579, 2.38418573772492e-9, -0.8500000238418579],
      max: [0.8500000238418579, 0.5400000017881393, 0.8500000238418579],
    },
    maxHeight: 0.5400000017881393,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,

  "trade-display-cabinet": {
    url: "/assets/shared/trading/trade-display-cabinet-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-display-cabinet"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, 0.009999999776482582, -0.44999998807907104],
      max: [0.9900000095367432, 1.5549999475479126, 0.47099998593330383],
    },
    maxHeight: 1.5549999475479126,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-air-display": {
    url: "/assets/shared/trading/trade-air-display-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-air-display"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, 0.009999999776482582, -0.44999998807907104],
      max: [0.9900000095367432, 1.3899999856948853, 0.47099998593330383],
    },
    maxHeight: 1.3899999856948853,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-packing-bench": {
    url: "/assets/shared/trading/trade-packing-bench-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-packing-bench"],
    destinationTags: [],
    footprint: [4, 1],
    bounds: {
      units: "meters",
      min: [-1.9700000286102295, 3.5762786065873797e-9, -0.4699999988079071],
      max: [1.9700000286102295, 1.2610000371932983, 0.4699999988079071],
    },
    maxHeight: 1.2610000371932983,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "trade-sample-display": {
    url: "/assets/shared/trading/trade-sample-display-v1.glb",
    category: "furniture",
    tags: ["shared", "trading", "trade-sample-display"],
    destinationTags: [],
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, 0.009999999776482582, -0.44999998807907104],
      max: [0.9900000095367432, 1.0824999809265137, 0.47099998593330383],
    },
    maxHeight: 1.0824999809265137,
    fallback: "trading-furniture",
    shadows: {
      cast: true,
      receive: true,
    },
    batch: "static",
    lod: "standard",
    budget: {
      maxTriangles: 20000,
      maxBytes: 2000000,
    },
    source: "scripts/assets/build-trading-assets.cjs",
    license: "repository-original",
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
  } as SceneAssetDefinition,
  "tech-workstation": {
    url: "/assets/shared/tech/tech-workstation-v1.glb",
    category: "furniture",
    tags: ["shared", "tech", "tech-workstation"],
    destinationTags: [],
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
    footprint: [2, 1],
    bounds: {
      units: "meters",
      min: [-0.9900000095367432, -1.0728836485895954e-8, -0.47999998927116394],
      max: [0.9900000095367432, 1.1600000005960465, 0.47999998927116394],
    },
    maxHeight: 1.1600000005960465,
    fallback: "tech-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-tech-startup.cjs",
    license: "repository-original",
  } as SceneAssetDefinition,
  "tech-server-rack": {
    url: "/assets/shared/tech/tech-server-rack-v1.glb",
    category: "furniture",
    tags: ["shared", "tech", "tech-server-rack"],
    destinationTags: [],
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
    footprint: [1, 1],
    bounds: {
      units: "meters",
      min: [-0.41499999165534973, 1.490116086078075e-10, -0.4300000071525574],
      max: [0.41499999165534973, 2.0850000381469727, 0.4975000023841858],
    },
    maxHeight: 2.0850000381469727,
    fallback: "tech-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-tech-startup.cjs",
    license: "repository-original",
  } as SceneAssetDefinition,
  "tech-phone-booth": {
    url: "/assets/shared/tech/tech-phone-booth-v1.glb",
    category: "furniture",
    tags: ["shared", "tech", "tech-phone-booth"],
    destinationTags: [],
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
    footprint: [1, 1],
    bounds: {
      units: "meters",
      min: [-0.4749999940395355, 5.9604643443123e-10, -0.4749999940395355],
      max: [0.4749999940395355, 2.25, 0.4749999940395355],
    },
    maxHeight: 2.25,
    fallback: "tech-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-tech-startup.cjs",
    license: "repository-original",
  } as SceneAssetDefinition,
  "tech-hardware-bench": {
    url: "/assets/shared/tech/tech-hardware-bench-v1.glb",
    category: "furniture",
    tags: ["shared", "tech", "tech-hardware-bench"],
    destinationTags: [],
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
    footprint: [1, 1],
    bounds: {
      units: "meters",
      min: [-0.49000000953674316, -5.9604645663569045e-9, -0.3675000000745058],
      max: [0.49000000953674316, 1.7100000047683717, 0.43500001072883604],
    },
    maxHeight: 1.7100000047683717,
    fallback: "tech-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-tech-startup.cjs",
    license: "repository-original",
  } as SceneAssetDefinition,
  "tech-beanbag": {
    url: "/assets/shared/tech/tech-beanbag-v1.glb",
    category: "furniture",
    tags: ["shared", "tech", "tech-beanbag"],
    destinationTags: [],
    localCoordinates: SCENE_ASSET_LOCAL_COORDINATES,
    footprint: [1, 1],
    bounds: {
      units: "meters",
      min: [-0.47624582052230835, 0.009999999776482582, -0.46000000834465027],
      max: [0.47624582052230835, 0.8399999737739563, 0.4699999988079071],
    },
    maxHeight: 0.8399999737739563,
    fallback: "tech-furniture",
    shadows: { cast: true, receive: true },
    batch: "static",
    lod: "standard",
    budget: { maxTriangles: 12000, maxBytes: 2000000 },
    source: "scripts/assets/build-tech-startup.cjs",
    license: "repository-original",
  } as SceneAssetDefinition,
  "photo-cyclorama": studioKit("photo-cyclorama", "photo", 6.8, 2.92, 2.9, [7, 3], {
    coral: "coral-sweep",
    oak: "oak",
    "painted-metal": "painted-metal",
  }),
  "photo-softbox": studioKit(
    "photo-softbox",
    "photo",
    0.82,
    2.1,
    0.82,
    [1, 1],
    { diffuser: "diffuser", "painted-metal": "painted-metal" },
    3000,
  ),
  "photo-camera-tripod": studioKit(
    "photo-camera-tripod",
    "photo",
    0.82,
    1.6,
    0.84,
    [1, 1],
    { "painted-metal": "painted-metal" },
    3000,
  ),
  "photo-reflector": studioKit(
    "photo-reflector",
    "photo",
    0.86,
    1.63,
    0.7,
    [1, 1],
    { diffuser: "reflector-cloth", "painted-metal": "painted-metal" },
    3000,
  ),
  "photo-equipment-shelf": studioKit("photo-equipment-shelf", "photo", 1.94, 2.27, 0.86, [2, 1], {
    oak: "oak",
    paper: "paper",
    "painted-metal": "painted-metal",
  }),
  "production-table-dressed": studioKit(
    "production-table-dressed",
    "production",
    5.2,
    1.18,
    2.2,
    [6, 3],
    { paper: "paper", "printed-paper": "printed-paper", ceramic: "ceramic" },
  ),
  "round-ideation-dressed": studioKit(
    "round-ideation-dressed",
    "ideation",
    2.2,
    1.03,
    2.2,
    [3, 3],
    { paper: "paper", "printed-paper": "printed-paper", ceramic: "ceramic" },
  ),
  "mobile-idea-board": studioKit("mobile-idea-board", "ideation", 1.7, 1.75, 0.18, [2, 1], {
    paper: "paper",
  }),
  "sample-display": studioKit(
    "sample-display",
    "production",
    1.7,
    1.49,
    0.62,
    [2, 1],
    { paper: "paper", oak: "oak" },
    12000,
  ),
  "pantry-counter-dressed": studioKit("pantry-counter-dressed", "pantry", 3.25, 1.48, 0.8, [4, 1], {
    oak: "oak",
    paper: "paper",
    ceramic: "ceramic",
    "painted-metal": "painted-metal",
  }),
  "art-wall-dressed": studioKit(
    "art-wall-dressed",
    "ideation",
    3.78,
    3.05,
    0.12,
    [4, 1],
    { oak: "oak", paper: "paper" },
    12000,
  ),
  "workstation-dressed": studioKit(
    "workstation-dressed",
    "production",
    0.88,
    1.43,
    0.94,
    [1, 1],
    { paper: "paper", ceramic: "ceramic", "painted-metal": "painted-metal" },
    12000,
  ),
  "conference-table-dressed": studioKit(
    "conference-table-dressed",
    "ideation",
    3.3,
    1.13,
    1.42,
    [4, 2],
    { paper: "paper", "printed-paper": "printed-paper", ceramic: "ceramic" },
    12000,
  ),
  "coffee-table-dressed": studioKit(
    "coffee-table-dressed",
    "ideation",
    0.94,
    0.64,
    0.54,
    [2, 2],
    { paper: "paper", "printed-paper": "printed-paper", ceramic: "ceramic" },
    3000,
  ),

  "shared-workstation": studioFurniture("workstation", 0.98, 0.88, 0.98, [1, 1], {
    destinationTags: ["work", "desk"],
  }),
  "shared-office-chair": studioFurniture("office-chair", 0.7, 1.1, 0.78, [1, 1], {
    seats: studioChairSeats,
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    destinationTags: ["work", "desk"],
  }),
  "shared-round-table": studioFurniture("round-table", 2.85, 0.87, 2.85, [3, 3], {
    destinationTags: ["ideation", "collaboration"],
  }),
  "shared-production-table": studioFurniture("production-table", 5.91, 0.87, 2.86, [6, 3], {
    destinationTags: ["production", "worktable"],
  }),
  "shared-curved-sofa": studioFurniture("curved-sofa", 3, 0.98, 1, [3, 1], {
    seats: studioSofaSeats(true),
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    destinationTags: ["lounge", "sofa"],
  }),
  "shared-sofa": studioFurniture("sofa", 2.98, 0.98, 0.84, [3, 1], {
    seats: studioSofaSeats(),
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    destinationTags: ["lounge", "sofa"],
  }),
  "shared-armchair": studioFurniture("armchair", 0.88, 0.98, 0.84, [1, 1], {
    seats: [{ anchor: [0, 1], visual: [0, 0.53, 0.3], actorElevation: 0.055, direction: "down" }],
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    destinationTags: ["lounge"],
  }),
  "shared-stool": studioFurniture("stool", 0.61, 0.73, 0.61, [1, 1], {
    variants: {
      olive: { oak: "#737b60" },
      blue: { oak: "#527ea3" },
      mint: { oak: "#9dbca8" },
      graphite: { oak: "#30383d" },
    },
    seats: [{ anchor: [0, 0], visual: [0, 0.72, 0], actorElevation: 0.24, direction: "down" }],
    destinationTags: ["pantry", "stool"],
  }),
  "shared-credenza": studioFurniture("credenza", 1.94, 1.08, 0.9, [2, 1]),
  "shared-low-shelf": studioFurniture("low-shelf", 1.94, 1.08, 0.82, [2, 1]),
  "shared-mobile-board": studioFurniture("mobile-board", 1.9, 1.9, 0.82, [2, 1], {
    destinationTags: ["ideation", "meeting"],
  }),
  "shared-round-rug": studioFurniture("round-rug", 3.78, 0.025, 3.78, [4, 4], {
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    shadows: { cast: false, receive: true },
  }),
  "shared-woven-rug": studioFurniture("woven-rug", 5.92, 0.025, 3.92, [6, 4], {
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    shadows: { cast: false, receive: true },
  }),
  "shared-counter": studioFurniture("counter", 3.99, 0.96, 0.98, [4, 1], {
    destinationTags: ["pantry"],
  }),
  "shared-conference-table": studioFurniture("conference-table", 3.91, 0.87, 1.86, [4, 2], {
    destinationTags: ["meeting"],
  }),
  "shared-coffee-table": studioFurniture("coffee-table", 1.75, 0.49, 1.75, [2, 2], {
    destinationTags: ["lounge"],
  }),
  "shared-oak-floor": architecture("oak-floor", 3, 0.035, 2),
  "shared-brick-panel": architecture("brick-panel", 2, 3.6, 0.24),
  "shared-plaster-panel": architecture("plaster-panel", 2, 3.6, 0.18),
  "shared-grid-window": architecture("grid-window", 4, 2.5, 0.34, true),
  "shared-glass-partition": architecture("glass-partition", 2, 3.6, 0.1, true),
  "shared-glass-corner": architecture("glass-corner", 1.1, 3.6, 1.1, true),
  "shared-glass-door": architecture("glass-door", 2, 3.6, 0.22, true),
  "shared-double-entrance": architecture("double-entrance", 4, 1.5, 0.22, true),
  "shared-cutaway-plinth": architecture("cutaway-plinth", 3, 0.32, 0.3),
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
  "shared-side-chair": studioFurniture("side-chair", 0.68, 1.02, 0.7, [1, 1], {
    seats: studioChairSeats,
    materialSlots: { oak: "oak", upholstery: "Cream linen" },
    variants: STUDIO_UPHOLSTERY_VARIANTS,
    destinationTags: ["ideation", "production", "meeting"],
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

/** Explicit visual capability; old untagged/executive furniture remains on its legacy path. */
export function studioFurnitureAsset(object: {
  type: string;
  variant?: string;
}): { id: SceneAssetId; variant?: string } | undefined {
  const { type, variant } = object;
  const fabric =
    variant && Object.hasOwn(STUDIO_UPHOLSTERY_VARIANTS, variant) ? variant : "off-white";
  if (type === "desk" && variant === "studio-oak") return { id: "shared-workstation" };
  if (type === "chair") {
    if (variant === "olive-office") return { id: "shared-office-chair", variant: "olive" };
    if (variant === "navy-office") return { id: "shared-office-chair", variant: "navy" };
    if (variant === "graphite") return { id: "shared-office-chair", variant: "graphite" };
    if (variant === "office-neutral") return { id: "shared-office-chair", variant: "neutral" };
    if (
      variant &&
      (Object.hasOwn(STUDIO_UPHOLSTERY_VARIANTS, variant) ||
        ["side-neutral", "meeting-neutral"].includes(variant))
    )
      return {
        id: "shared-side-chair",
        variant: variant.endsWith("-neutral") ? "neutral" : variant,
      };
    return undefined;
  }
  if (type === "studio_sofa")
    return {
      id: variant === "curved-off-white" ? "shared-curved-sofa" : "shared-sofa",
      variant: fabric,
    };
  if (type === "office_armchair" && variant && Object.hasOwn(STUDIO_UPHOLSTERY_VARIANTS, variant))
    return { id: "shared-armchair", variant: fabric };
  if (type === "studio_stool")
    return {
      id: "shared-stool",
      variant:
        variant && ["olive", "blue", "mint", "graphite"].includes(variant) ? variant : undefined,
    };
  if (type === "studio_round_table") return { id: "shared-round-table" };
  if (type === "studio_worktable") return { id: "shared-production-table" };
  if (type === "studio_counter") return { id: "shared-counter" };
  if (type === "studio_shelf")
    return {
      id: ["credenza", "pantry-storage"].includes(variant ?? "")
        ? "shared-credenza"
        : "shared-low-shelf",
    };
  if (type === "mobile_board") return { id: "shared-mobile-board" };
  if (type === "conference_table" && variant === "studio-oak")
    return { id: "shared-conference-table" };
  if (type === "meeting_table" && variant === "round-low") return { id: "shared-coffee-table" };
  if (type === "studio_round_rug") return { id: "shared-round-rug", variant: fabric };
  if (type === "studio_woven_rug") return { id: "shared-woven-rug", variant: fabric };
  return undefined;
}

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
