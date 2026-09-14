import { sceneAsset, type SceneAssetId } from "./scene-asset-catalog";

function legacySharedAsset(
  id: SceneAssetId,
  category: "indoor-plant" | "exterior-tree" | "backdrop-building",
  footprint: readonly [number, number],
) {
  const asset = sceneAsset(id);
  return {
    url: asset.url,
    category,
    footprint,
    maxHeight: asset.maxHeight,
  };
}

/** Compatibility view; new consumers should use SCENE_ASSETS and sceneAsset(). */
export const SHARED_SCENE_ASSETS = {
  ficus: legacySharedAsset("shared-ficus", "indoor-plant", [1, 1]),
  olive: legacySharedAsset("shared-olive", "indoor-plant", [1, 1]),
  "street-tree": legacySharedAsset("shared-street-tree", "exterior-tree", [3.6, 3.6]),
  "glass-tower": legacySharedAsset("shared-glass-tower", "backdrop-building", [1.6, 1.4]),
  "stone-tower": legacySharedAsset("shared-stone-tower", "backdrop-building", [1.6, 1.4]),
} as const;
export type SharedSceneAsset = keyof typeof SHARED_SCENE_ASSETS;
