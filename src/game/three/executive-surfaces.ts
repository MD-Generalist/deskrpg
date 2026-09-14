import * as T from "three";

/** Scene-owned maps: dispose callbacks also cover images arriving after map unload. */
export function executiveSurface(
  host: T.Group,
  surface: "walnut" | "limestone",
): T.MeshStandardMaterial {
  const material = new T.MeshStandardMaterial({
    color: surface === "walnut" ? "#62422d" : "#d9cbb5",
    roughness: surface === "walnut" ? 0.48 : 0.38,
  });
  material.userData.dynamicSurface = true;
  const status = new T.Group();
  status.userData.dynamicAsset = true;
  status.userData.assetStatus = "loading";
  host.add(status);
  let disposed = false;
  const textures: T.Texture[] = [];
  material.addEventListener("dispose", () => {
    disposed = true;
    textures.forEach((texture) => texture.dispose());
  });
  const loader = new T.TextureLoader();
  status.userData.assetReady = Promise.all(
    ["color", "normal", "roughness"].map((kind) =>
      loader.loadAsync(`/assets/furniture/executive/${surface}-${kind}.webp`).then((texture) => {
        textures.push(texture);
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.anisotropy = 4;
        texture.colorSpace = kind === "color" ? T.SRGBColorSpace : T.NoColorSpace;
        if (kind === "color") {
          material.map = texture;
          material.color.set("#ffffff");
        }
        if (kind === "normal") {
          material.normalMap = texture;
          material.normalScale.setScalar(0.35);
        }
        if (kind === "roughness") {
          material.roughnessMap = texture;
          material.roughness = 1;
        }
        material.needsUpdate = true;
      }),
    ),
  )
    .then(() => {
      status.userData.assetStatus = "ready";
    })
    .catch(() => {
      status.userData.assetStatus = "failed";
    });
  return material;
}
