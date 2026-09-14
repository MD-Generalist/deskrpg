import * as T from "three";
import { attachSceneAsset, type AttachSceneAssetOptions } from "./scene-asset-catalog";
import { type SceneAssetId } from "./scene-asset-definitions";
import { round } from "./primitives";

export const CREATIVE_STUDIO_KIT_IDS = [
  "photo-cyclorama",
  "photo-softbox",
  "photo-camera-tripod",
  "photo-reflector",
  "photo-equipment-shelf",
  "production-table-dressed",
  "round-ideation-dressed",
  "mobile-idea-board",
  "sample-display",
  "pantry-counter-dressed",
  "art-wall-dressed",
  "workstation-dressed",
  "conference-table-dressed",
  "coffee-table-dressed",
] as const satisfies readonly SceneAssetId[];
export type CreativeStudioKitId = (typeof CREATIVE_STUDIO_KIT_IDS)[number];
type KitObject = { type: string; variant?: string };
/** Selection only; callers retain authoritative footprint, collision, seats and object placement. */
export function creativeStudioKitFor({
  type,
  variant,
}: KitObject): CreativeStudioKitId | undefined {
  if (type === "photo_cyclorama") return "photo-cyclorama";
  if (type === "photo_camera") return "photo-camera-tripod";
  if (type === "photo_light") return "photo-softbox";
  if (type === "photo_reflector") return "photo-reflector";
  if (type === "studio_shelf" && variant === "equipment") return "photo-equipment-shelf";
  if (type === "studio_shelf" && variant === "sample-rack") return "sample-display";
  if (type === "studio_worktable") return "production-table-dressed";
  if (type === "studio_round_table") return "round-ideation-dressed";
  if (type === "mobile_board" && (variant === "idea-board" || variant === "meeting-board"))
    return "mobile-idea-board";
  if (type === "studio_counter") return "pantry-counter-dressed";
  if (type === "studio_art_wall") return "art-wall-dressed";
  if (type === "computer" && variant === "studio-monitor") return "workstation-dressed";
  if (type === "conference_table" && variant === "studio-oak") return "conference-table-dressed";
  if (type === "meeting_table" && variant === "round-low") return "coffee-table-dressed";
  return undefined;
}
/** Extras stay inside the existing solid photo footprint and perimeter wall strip. */
export function creativeStudioDecorations() {
  return [
    {
      object: { type: "photo_reflector", variant: "silver" },
      position: [8.1, 0, 4.2] as const,
      rotationY: -0.55,
    },
    {
      object: { type: "studio_art_wall", variant: "gallery" },
      position: [26, 0, 0.4] as const,
      rotationY: 0,
    },
  ];
}
/** Standalone kits replace a furniture silhouette; all other kits are additive dressing. */
export function creativeStudioKitOwnsBody(id: CreativeStudioKitId) {
  return id.startsWith("photo-");
}

/** Scene-owned fallback geometry stays useful when the GLB or texture request fails. */
export function buildCreativeStudioKitFallback(id: CreativeStudioKitId): T.Group {
  const group = new T.Group();
  group.name = `fallback:${id}`;
  const materials = {
    wood: new T.MeshStandardMaterial({ color: "#c9ac81", roughness: 0.65 }),
    paper: new T.MeshStandardMaterial({ color: "#eee3cc", roughness: 0.94 }),
    dark: new T.MeshStandardMaterial({ color: "#263330", metalness: 0.4, roughness: 0.4 }),
    coral: new T.MeshStandardMaterial({ color: "#cb7965", roughness: 0.87 }),
    teal: new T.MeshStandardMaterial({ color: "#387b72", roughness: 0.86 }),
  };
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = materials.paper,
  ) => round(group, w, h, d, m, x, y, z, Math.min(0.012, w * 0.2, h * 0.2, d * 0.2));
  const rod = (
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = materials.dark,
  ) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 20), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const stand = (h: number) => {
    rod(0.018, h, 0, h / 2, 0);
    for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const foot = box(
        0.035,
        0.035,
        0.35,
        Math.sin(angle) * 0.16,
        0.025,
        Math.cos(angle) * 0.16,
        materials.dark,
      );
      foot.rotation.y = angle;
    }
  };
  if (id === "photo-cyclorama") {
    // Same floor-to-wall profile as the asset, with fewer bend segments.
    const profile: [number, number][] = [
      [1.4, 0.045],
      [-0.6, 0.045],
    ];
    for (let i = 1; i <= 12; i++) {
      const angle = (i * Math.PI) / 24;
      profile.push([-0.6 - 0.74 * Math.sin(angle), 0.045 + 0.74 * (1 - Math.cos(angle))]);
    }
    profile.push([-1.34, 2.72]);
    const vertices: number[] = [],
      indices: number[] = [];
    for (const [z, y] of profile) vertices.push(-3.19, y, z, 3.19, y, z);
    for (let i = 0; i < profile.length - 1; i++)
      indices.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    group.add(new T.Mesh(geometry, materials.coral));
    for (const x of [-3.3, 3.3]) rod(0.025, 2.88, x, 1.44, -1.35);
    rod(0.22, 0.06, 0.1, 0.57, 0.4, materials.wood);
  } else if (id === "photo-softbox") {
    stand(1.5);
    box(0.79, 0.83, 0.24, 0, 1.65, 0, materials.dark);
    box(0.7, 0.74, 0.01, 0, 1.65, 0.126);
  } else if (id === "photo-camera-tripod") {
    stand(1.25);
    box(0.38, 0.24, 0.2, 0, 1.42, 0, materials.dark);
    const lens = rod(0.085, 0.2, 0, 1.43, 0.18);
    lens.rotation.x = Math.PI / 2;
  } else if (id === "photo-reflector") {
    stand(1.02);
    const disk = rod(0.4, 0.025, 0, 1.19, 0, materials.paper);
    disk.rotation.x = Math.PI / 2;
  } else if (id === "photo-equipment-shelf") {
    for (const x of [-0.91, 0.91]) for (const z of [-0.36, 0.36]) rod(0.022, 2.08, x, 1.04, z);
    for (const y of [0.16, 0.76, 1.36, 1.98]) box(1.9, 0.045, 0.82, 0, y, 0, materials.wood);
    for (const x of [-0.6, 0, 0.6]) {
      box(0.35, 0.36, 0.42, x, 0.36, 0, materials.dark);
      box(0.3, 0.3, 0.4, x, 0.94, 0, materials.dark);
    }
  } else if (id === "mobile-idea-board") {
    for (let i = 0; i < 12; i++)
      box(
        0.25,
        0.17,
        0.008,
        -0.63 + (i % 4) * 0.42,
        0.89 + Math.floor(i / 4) * 0.27,
        0.065,
        i % 3 ? materials.paper : materials.coral,
      );
  } else if (id === "sample-display") {
    for (let i = 0; i < 6; i++)
      box(0.18, 0.31, 0.1, -0.72 + i * 0.27, 1.23, 0.1, i % 2 ? materials.teal : materials.coral);
  } else if (id === "art-wall-dressed") {
    box(3.14, 1.85, 0.026, -0.32, 2.12, -0.04, materials.wood);
    for (let i = 0; i < 5; i++) {
      const x = -1.42 + (i % 3) * 1.1,
        y = 1.75 + Math.floor(i / 3) * 0.91;
      box(0.88, 0.75, 0.05, x, y, 0, materials.wood);
      box(0.76, 0.63, 0.01, x, y, 0.033);
      box(0.35, 0.4, 0.005, x - 0.12, y, 0.043, i % 2 ? materials.teal : materials.coral);
    }
  } else if (id === "pantry-counter-dressed") {
    box(0.53, 0.49, 0.4, 1.12, 1.2, 0, materials.dark);
    box(0.46, 0.25, 0.02, 1.12, 1.2, 0.212);
    for (const x of [-1.48, -1.29, -1.1]) rod(0.06, 0.26, x, 1.09, -0.04, materials.teal);
    rod(0.22, 0.07, -0.36, 1, 0.08);
  } else if (id === "workstation-dressed") {
    box(0.6, 0.36, 0.04, 0, 1.22, -0.25, materials.dark);
    rod(0.021, 0.23, 0, 0.985, -0.25);
    box(0.39, 0.015, 0.13, -0.03, 0.88, 0.07, materials.dark);
  } else {
    const production = id === "production-table-dressed",
      round = id === "round-ideation-dressed",
      coffee = id === "coffee-table-dressed";
    const height = coffee ? 0.497 : 0.87,
      count = production ? 10 : round ? 6 : coffee ? 2 : 6;
    for (let i = 0; i < count; i++) {
      let x, z;
      if (round) {
        x = Math.sin((i * Math.PI) / 3) * 0.85;
        z = Math.cos((i * Math.PI) / 3) * 0.85;
      } else {
        x = coffee
          ? -0.22 + i * 0.4
          : ((i % (production ? 5 : 3)) - (production ? 2 : 1)) * (production ? 0.95 : 1.15);
        z = coffee ? 0 : i < count / 2 ? -0.49 : 0.49;
      }
      box(coffee ? 0.23 : 0.3, 0.008, coffee ? 0.3 : 0.35, x, height, z);
      box(
        0.08,
        0.003,
        0.14,
        x + 0.035,
        height + 0.006,
        z,
        i % 2 ? materials.teal : materials.coral,
      );
    }
    if (production) box(1.22, 0.012, 0.85, -0.25, 0.87, 0.05, materials.teal);
  }
  const retained = new Set<T.Material>();
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) retained.add(m);
    }
  });
  for (const m of Object.values(materials)) if (!retained.has(m)) m.dispose();
  return group;
}

/** A dedicated child preserves base furniture/seat ownership during async replacement. */
export function attachCreativeStudioKit(
  host: T.Group,
  object: KitObject,
  options: AttachSceneAssetOptions = {},
): Promise<boolean> {
  const id = creativeStudioKitFor(object);
  if (!id) return Promise.resolve(false);
  const kit = new T.Group();
  kit.name = `kit:${id}`;
  kit.userData.kitId = id;
  kit.userData.kitOwnsBody = creativeStudioKitOwnsBody(id);
  kit.add(buildCreativeStudioKitFallback(id));
  host.add(kit);
  return attachSceneAsset(kit, id, options);
}
