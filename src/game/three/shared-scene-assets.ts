/** Shared, authored assets. Coordinates: meters, Y-up, +Z front; origin at ground. */
export const SHARED_SCENE_ASSETS = {
  ficus: {
    url: "/assets/shared/landscape/ficus-v1.glb",
    category: "indoor-plant",
    footprint: [1, 1],
    maxHeight: 1.7,
  },
  olive: {
    url: "/assets/shared/landscape/olive-v1.glb",
    category: "indoor-plant",
    footprint: [1, 1],
    maxHeight: 1.7,
  },
  "street-tree": {
    url: "/assets/shared/landscape/street-tree-v1.glb",
    category: "exterior-tree",
    footprint: [3.5, 3.5],
    maxHeight: 4,
  },
  "glass-tower": {
    url: "/assets/shared/landscape/glass-tower-v1.glb",
    category: "backdrop-building",
    footprint: [1.6, 1.4],
    maxHeight: 8,
  },
  "stone-tower": {
    url: "/assets/shared/landscape/stone-tower-v1.glb",
    category: "backdrop-building",
    footprint: [1.6, 1.4],
    maxHeight: 7,
  },
} as const;
export type SharedSceneAsset = keyof typeof SHARED_SCENE_ASSETS;
