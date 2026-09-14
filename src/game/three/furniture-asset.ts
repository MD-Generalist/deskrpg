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
  name: ExecutiveAsset,
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
  const ready = load(executiveAssetUrl(name))
    .then((model) => {
      if (disposed) {
        disposeTree(model);
        return false;
      }
      model.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!(material instanceof T.MeshStandardMaterial)) continue;
          material.envMapIntensity = 0.55;
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
