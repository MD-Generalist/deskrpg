import { SHARED_SCENE_ASSETS, type SharedSceneAsset } from "./shared-scene-assets";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeTree } from "./dispose-tree";

export type ExecutiveAsset =
  | "desk"
  | "chair"
  | "bookcase"
  | "rug"
  | "guest-chair"
  | "sofa"
  | "armchair"
  | "conference"
  | "coffee";
export const executiveAssetUrl = (name: ExecutiveAsset) =>
  `/assets/furniture/executive/${name}-v1.glb`;

/** The host owns both fallback and loaded resources, including late-load cancellation. */
export function attachFurnitureAsset(
  host: T.Group,
  name: ExecutiveAsset | SharedSceneAsset,
  load: (url: string) => Promise<T.Group> = async (url) =>
    (await new GLTFLoader().loadAsync(url)).scene,
) {
  let disposed = false;
  host.userData.dynamicAsset = true;
  host.userData.assetStatus = "loading";
  host.userData.disposeActor = () => {
    disposed = true;
  };
  const fallback = [...host.children];
  const url =
    name in SHARED_SCENE_ASSETS
      ? SHARED_SCENE_ASSETS[name as SharedSceneAsset].url
      : executiveAssetUrl(name as ExecutiveAsset);
  const ready = load(url)
    .then((model) => {
      if (disposed) {
        disposeTree(model);
        return false;
      }
      model.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        object.receiveShadow = true;
        object.castShadow = !(
          name in SHARED_SCENE_ASSETS &&
          SHARED_SCENE_ASSETS[name as SharedSceneAsset].category === "backdrop-building"
        );
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!(material instanceof T.MeshStandardMaterial)) continue;
          material.envMapIntensity = 0.55;
          // Macro silhouettes come from geometry; texture relief stays subtle
          // under the office sun, especially on broad walnut tabletops.
          material.normalScale.multiplyScalar(0.12);
          for (const value of Object.values(material))
            if (value instanceof T.Texture) value.anisotropy = 4;
        }
      });
      for (const object of fallback) {
        host.remove(object);
        disposeTree(object);
      }
      host.add(model);
      host.userData.assetStatus = "ready";
      return true;
    })
    .catch(() => {
      if (!disposed) host.userData.assetStatus = "failed";
      return false;
    });
  host.userData.assetReady = ready;
  return ready;
}

/** Shared scene loader; furniture alias retained for existing callers. */
export const attachSceneAsset = attachFurnitureAsset;
