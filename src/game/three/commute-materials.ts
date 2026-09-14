import * as T from "three";

export type CommuteQuality = "desktop" | "light";
export type CommuteMaterialName =
  | "asphalt"
  | "paving"
  | "facade"
  | "glass"
  | "vehiclePaint"
  | "rubber"
  | "metal"
  | "wood"
  | "bark"
  | "leaf";
type Surface = "asphalt" | "paving" | "facade" | "wood" | "bark" | "leaf";

export interface CommuteMaterials {
  readonly materials: Readonly<Record<CommuteMaterialName, T.MeshStandardMaterial>>;
  readonly textures: readonly T.DataTexture[];
  readonly leafDepthMaterial: T.MeshDepthMaterial;
  readonly leafDistanceMaterial: T.MeshDistanceMaterial;
  /** Creates an owned color variant sharing the palette's textures. */
  clone(name: CommuteMaterialName, color?: T.ColorRepresentation): T.MeshStandardMaterial;
  dispose(): void;
}

/** Integer hash: deterministic across browsers, with no global random state. */
function noise(x: number, y: number, seed: number): number {
  let n = Math.imul(x + seed, 374761393) + Math.imul(y + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function texture(surface: Surface, size: number, seed: number, dataMap = false): T.DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  const byte = (v: number) => Math.round(T.MathUtils.clamp(v, 0, 1) * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const grain = noise(x, y, seed);
      let value = 0.96,
        height = 0.5,
        alpha = 1;
      switch (surface) {
        case "asphalt": {
          // Fine aggregate with occasional pale chips; deliberately low contrast.
          height = 0.35 + grain * 0.5;
          value = 0.85 + grain * 0.13 + (grain > 0.96 ? 0.02 : 0);
          break;
        }
        case "paving": {
          // Offset masonry joints tile exactly at both texture boundaries.
          const row = Math.floor(v * 4);
          const joint = (u * 4 + (row % 2) * 0.5) % 1 < 0.035 || (v * 4) % 1 < 0.045;
          height = joint ? 0.05 : 0.8 + grain * 0.1;
          value = joint ? 0.74 : 0.93 + noise(Math.floor(u * 8), row, seed) * 0.05;
          break;
        }
        case "facade": {
          height = 0.4 + grain * 0.2;
          value = 0.95 + grain * 0.05;
          break;
        }
        case "wood": {
          const wave = Math.sin(u * Math.PI * 24 + Math.sin(v * Math.PI * 2) * 1.5);
          height = 0.5 + wave * 0.22 + grain * 0.05;
          value = 0.89 + wave * 0.06 + grain * 0.035;
          break;
        }
        case "bark": {
          const groove = Math.sin(u * Math.PI * 20 + Math.sin(v * Math.PI * 4) * 0.65);
          height = 0.45 + groove * 0.3 + grain * 0.15;
          value = 0.83 + groove * 0.1 + grain * 0.06;
          break;
        }
        case "leaf": {
          // One pointed, gently asymmetric leaf per quad, including a visible midrib.
          const length = (v - 0.045) / 0.91;
          const center = 0.5 + 0.035 * Math.sin(v * Math.PI * 2);
          const width =
            length > 0 && length < 1 ? 0.39 * Math.pow(Math.sin(length * Math.PI), 0.85) : 0;
          const distance = Math.abs(u - center);
          alpha = width > 0 && distance < width ? 1 : 0;
          const midrib = distance < 0.009;
          const vein = Math.abs(Math.sin((v + distance * 0.7) * Math.PI * 14)) < 0.12;
          value = midrib ? 1 : 0.86 + grain * 0.06 + (vein ? 0.035 : 0);
          break;
        }
      }
      const offset = (y * size + x) * 4;
      const shade = byte(dataMap ? height : value);
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = byte(alpha);
    }
  }
  const map = new T.DataTexture(pixels, size, size, T.RGBAFormat);
  map.name = `commute:${surface}:${dataMap ? "height" : "color"}`;
  map.colorSpace = dataMap ? T.NoColorSpace : T.SRGBColorSpace;
  map.wrapS = map.wrapT = surface === "leaf" ? T.ClampToEdgeWrapping : T.RepeatWrapping;
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/**
 * Pale, tactile model-making finishes for the morning district.
 * No DOM, network, renderer, or environment ownership. All returned materials,
 * clones and textures belong to this palette: dispose it once AFTER removing its
 * meshes. Scene traversal must not separately dispose borrowed palette resources.
 * Attach both supplied custom shadow materials to leaf meshes/InstancedMeshes.
 * Desktop uses subtle bump detail; light retains color detail at one quarter area.
 * UVs cover one texture tile: geometry builders control repeats with their UV scale.
 */
export function createCommuteMaterials({
  quality = "desktop",
  seed = 1979,
}: { quality?: CommuteQuality; seed?: number } = {}): CommuteMaterials {
  const size = quality === "desktop" ? 128 : 64;
  const textures: T.DataTexture[] = [];
  const owned = new Set<T.Material>();
  const surface = (name: Surface, color: string, roughness: number, bumpScale: number) => {
    const map = texture(name, size, seed);
    textures.push(map);
    const bumpMap =
      quality === "desktop" && name !== "leaf" ? texture(name, size, seed, true) : null;
    if (bumpMap) textures.push(bumpMap);
    return new T.MeshStandardMaterial({ color, map, roughness, bumpMap, bumpScale, metalness: 0 });
  };
  const materials: Record<CommuteMaterialName, T.MeshStandardMaterial> = {
    asphalt: surface("asphalt", "#879997", 0.96, 0.018),
    paving: surface("paving", "#e9e1cc", 0.86, 0.025),
    facade: surface("facade", "#ece2cb", 0.81, 0.012),
    glass: new T.MeshPhysicalMaterial({
      color: "#83b4b1",
      roughness: 0.14,
      metalness: 0.18,
      clearcoat: 0.65,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.1,
    }),
    vehiclePaint: new T.MeshPhysicalMaterial({
      color: "#e8c486",
      roughness: 0.3,
      metalness: 0.12,
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
    }),
    rubber: new T.MeshStandardMaterial({ color: "#465653", roughness: 0.98 }),
    metal: new T.MeshStandardMaterial({ color: "#a4b3aa", roughness: 0.36, metalness: 0.82 }),
    wood: surface("wood", "#b99b76", 0.72, 0.017),
    bark: surface("bark", "#9b8260", 0.95, 0.04),
    leaf: surface("leaf", "#92ae7a", 0.86, 0),
  };
  const leafCutout = { map: materials.leaf.map, alphaTest: 0.45, side: T.DoubleSide };
  Object.assign(materials.leaf, leafCutout);
  materials.leaf.shadowSide = T.DoubleSide;
  const leafDepthMaterial = new T.MeshDepthMaterial({
    ...leafCutout,
    depthPacking: T.RGBADepthPacking,
  });
  const leafDistanceMaterial = new T.MeshDistanceMaterial(leafCutout);
  for (const [name, material] of Object.entries(materials)) {
    material.name = `commute:${name}`;
    owned.add(material);
  }
  owned.add(leafDepthMaterial);
  owned.add(leafDistanceMaterial);
  let disposed = false;
  return {
    materials,
    textures: Object.freeze(textures),
    leafDepthMaterial,
    leafDistanceMaterial,
    clone(name, color) {
      if (disposed) throw new Error("Commute material palette is disposed");
      const variant = materials[name].clone();
      if (color !== undefined) variant.color.set(color);
      owned.add(variant);
      return variant;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of owned) material.dispose();
      for (const map of textures) map.dispose();
      owned.clear();
    },
  };
}
