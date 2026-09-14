import * as T from "three";
export type Surface = "wood" | "fabric" | "leather" | "metal" | "book";
type SurfaceChannel = "height" | "color" | "roughness";
/** Deterministic, tileable grain/weave. Shared per disposable tree, never per frame. */
export function surfaceTexture(surface: Surface, channel: SurfaceChannel = "height") {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const warp = Math.sin(v * tau) * 1.15 + Math.sin(v * tau * 3 + u * tau) * 0.35;
      const grain =
        Math.sin(u * tau * 12 + warp) * 0.55 +
        Math.sin(u * tau * 29 + warp * 2) * 0.25 +
        Math.sin(u * tau * 61 + Math.sin(v * tau * 2) * 0.4) * 0.12;
      const weave =
        Math.sin(u * tau * 32) * Math.sin(v * tau * 32) * 0.6 +
        Math.cos(u * tau * 64) * 0.16 +
        Math.cos(v * tau * 64) * 0.16;
      const pores =
        Math.sin(u * tau * 47 + Math.sin(v * tau * 31)) *
        Math.cos(v * tau * 53 + Math.sin(u * tau * 23));
      const brushed = Math.sin(v * tau * 91) * 0.6 + Math.sin(v * tau * 37) * 0.3;
      const bookBand = (v > 0.15 && v < 0.18) || (v > 0.77 && v < 0.89);
      const detail =
        surface === "wood"
          ? grain
          : surface === "fabric"
            ? weave
            : surface === "metal"
              ? brushed
              : surface === "book"
                ? bookBand
                  ? 0.9
                  : -0.45
                : pores;
      // Neutral albedo multiplies the existing palette, preserving outfit identity.
      const value =
        channel === "color"
          ? 238 + detail * (surface === "wood" ? 11 : 16)
          : channel === "roughness"
            ? (surface === "wood" ? 200 : 244) + detail * 10
            : 128 + detail * 65;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(value);
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.colorSpace = channel === "color" ? T.SRGBColorSpace : T.NoColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(
    surface === "book" ? 1 : surface === "wood" ? 2 : 3,
    surface === "book" || surface === "wood" ? 1 : 3,
  );
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
/** Textures are shared only within this disposable object tree. */
export function detailSurfaces(
  root: T.Object3D,
  wood: string[],
  fabric: string[],
  metals: string[] = [],
) {
  const colors = (values: string[]) => new Set(values.map((value) => new T.Color(value).getHex()));
  const woods = colors(wood),
    fabrics = colors(fabric),
    metal = colors(metals);
  const maps = new Map<string, T.Texture>();
  const getMap = (surface: Surface, channel: SurfaceChannel) => {
    const key = `${surface}:${channel}`;
    if (!maps.has(key)) maps.set(key, surfaceTexture(surface, channel));
    return maps.get(key)!;
  };
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || material.transparent || material.bumpMap)
        continue;
      const color = material.color.getHex();
      const tagged = material.userData.surface as Surface | undefined;
      const surface =
        tagged ??
        (woods.has(color)
          ? "wood"
          : fabrics.has(color)
            ? "fabric"
            : metal.has(color)
              ? "metal"
              : undefined);
      if (surface) {
        material.bumpMap = getMap(surface, "height");
        material.roughnessMap = getMap(surface, "roughness");
        if (!material.map) material.map = getMap(surface, "color");
        material.bumpScale =
          surface === "wood" ? 0.025 : surface === "metal" || surface === "book" ? 0.003 : 0.012;
        material.roughness =
          surface === "metal"
            ? 0.45
            : surface === "leather"
              ? 0.7
              : surface === "wood"
                ? 0.75
                : 1.0;
        if (surface === "metal") material.metalness = 0.65;
        material.needsUpdate = true;
      }
    }
  });
}
