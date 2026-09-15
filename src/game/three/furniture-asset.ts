import type * as T from "three";
import type { SharedSceneAsset } from "./shared-scene-assets";
import {
  attachSceneAsset as attachCatalogAsset,
  sceneAsset,
  type SceneAssetId,
  type SceneAssetLoader,
} from "./scene-asset-catalog";

export type ExecutiveAsset =
  | "desk"
  | "executive-desk"
  | "chair"
  | "bookcase"
  | "rug"
  | "guest-chair"
  | "sofa"
  | "armchair"
  | "conference"
  | "coffee";

const LEGACY_ASSET_IDS = {
  ficus: "shared-ficus",
  olive: "shared-olive",
  "street-tree": "shared-street-tree",
  "glass-tower": "shared-glass-tower",
  "stone-tower": "shared-stone-tower",
  desk: "executive-work-desk",
  "executive-desk": "executive-desk",
  chair: "executive-office-chair",
  bookcase: "executive-bookcase",
  rug: "executive-rug",
  "guest-chair": "executive-guest-chair",
  sofa: "executive-sofa",
  armchair: "executive-armchair",
  conference: "executive-conference-table",
  coffee: "executive-coffee-table",
} as const satisfies Record<ExecutiveAsset | SharedSceneAsset, SceneAssetId>;

export const executiveAssetUrl = (name: ExecutiveAsset) => sceneAsset(LEGACY_ASSET_IDS[name]).url;

/** Compatibility adapter; new consumers should call the typed catalog loader. */
export function attachFurnitureAsset(
  host: T.Group,
  name: ExecutiveAsset | SharedSceneAsset,
  load?: SceneAssetLoader,
) {
  return attachCatalogAsset(host, LEGACY_ASSET_IDS[name], load ? { load } : undefined);
}

/** Shared scene loader alias retained for existing callers. */
export const attachSceneAsset = attachFurnitureAsset;
