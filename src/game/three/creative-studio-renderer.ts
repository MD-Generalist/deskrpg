import * as T from "three";
import type { MapObject } from "../../lib/object-types";
import { getObjectDimensions } from "../../lib/object-types";
import type { MapSnapshot } from "./bridge";
import { addCreativeStudioArchitecture, isCreativeStudioMap } from "./creative-studio-architecture";
import {
  attachSceneAsset,
  type AttachSceneAssetOptions,
  type SceneAssetId,
} from "./scene-asset-catalog";
import { studioFurnitureAsset, buildStudioFurnitureFallback } from "./studio-furniture";
import {
  creativeStudioKitFor,
  creativeStudioKitOwnsBody,
  attachCreativeStudioKit,
  creativeStudioDecorations,
} from "./creative-studio-kits";
import { attachFurnitureSeats } from "./seat-picking";
import { resolveSeat } from "./seating";
import { furnitureOffset } from "./executive-lounge-layout";
import { buildRoomFurniture } from "./room-furniture";
import { addOfficeDetails } from "./office-details";
import { attachFurnitureAsset, type ExecutiveAsset } from "./furniture-asset";
import { batchStaticFurniture, batchCoplanarGlass } from "./static-batching";
import { round } from "./primitives";

type StudioOptions = AttachSceneAssetOptions & {
  loadTexture?: (url: string) => Promise<T.Texture>;
};
const angles = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
/** Monitors face the user of their desk; orientation never changes navigation records. */
export function studioObjectDirection(object: MapObject, objects: readonly MapObject[]) {
  if (object.type === "chair") return resolveSeat(object, [...objects]).direction;
  if (object.type === "computer" && object.variant === "studio-monitor") {
    const chair = objects
      .filter(
        (o) =>
          o.type === "chair" && Math.abs(o.col - object.col) + Math.abs(o.row - object.row) === 1,
      )
      .sort((a, b) => Math.abs(a.col - object.col) - Math.abs(b.col - object.col))[0];
    if (chair)
      return { down: "up", up: "down", left: "right", right: "left" }[
        resolveSeat(chair, [...objects]).direction
      ] as keyof typeof angles;
  }
  return object.direction ?? "down";
}
function plantFallback(variant?: string) {
  const root = new T.Group();
  round(root, 0.26, 0.32, 0.26, "#d4c3a2", 0, 0.16, 0, 0.025);
  round(root, 0.035, 0.85, 0.035, "#66573d", 0, 0.72, 0, 0.01);
  if (variant === "monstera") {
    const leafMaterial = new T.MeshStandardMaterial({ color: "#477052", roughness: 0.88 });
    for (let i = 0; i < 7; i++) {
      const angle = (i * Math.PI * 2) / 7;
      const stem = round(root, 0.018, 0.62, 0.018, "#587259", 0, 0.67, 0, 0.006);
      stem.rotation.z = Math.sin(angle) * 0.42;
      stem.rotation.x = Math.cos(angle) * 0.42;
      const leaf = new T.Mesh(new T.SphereGeometry(0.25, 12, 8), leafMaterial);
      leaf.position.set(Math.sin(angle) * 0.25, 0.96 + (i % 2) * 0.12, Math.cos(angle) * 0.25);
      leaf.scale.set(1.35, 0.18, 0.8);
      leaf.rotation.y = angle;
      leaf.castShadow = true;
      root.add(leaf);
    }
    return root;
  }
  const foliage = new T.Mesh(
    new T.SphereGeometry(0.28, 10, 8),
    new T.MeshStandardMaterial({ color: "#53744b", roughness: 0.85 }),
  );
  foliage.position.y = 1.03;
  foliage.scale.y = 1.35;
  root.add(foliage);
  return root;
}

/** Caller owns placement via this adapter; unsupported legacy objects remain generic. */
export function renderCreativeStudioObject(
  host: T.Group,
  object: MapObject,
  objects: MapObject[] = [object],
  options: StudioOptions = {},
): boolean {
  if (["glass_partition", "cubicle_wall", "room_wall_h", "room_wall_v"].includes(object.type)) {
    host.userData.assetReady = Promise.resolve(true);
    return true;
  }
  const selection = studioFurnitureAsset(object),
    kit = creativeStudioKitFor(object),
    plant = object.type === "plant",
    directorFurniture =
      (object.variant === "studio-director" &&
        [
          "executive_desk",
          "chair",
          "bookshelf",
          "low_cabinet",
          "office_sofa",
          "office_armchair",
          "meeting_table",
          "floor_lamp",
        ].includes(object.type)) ||
      (object.type === "computer" && object.variant === "director-monitor"),
    roomFurniture = [
      "meeting_display",
      "kitchen_counter",
      "microwave_cabinet",
      "refrigerator",
    ].includes(object.type);
  if (!selection && !kit && !plant && !roomFurniture && !directorFurniture) return false;
  const size = getObjectDimensions(object.type, object.direction),
    offset = furnitureOffset(object),
    direction = studioObjectDirection(object, objects);
  host.name = `studio-object:${object.id}`;
  host.userData.mapObjectId = object.id;
  host.userData.objectType = object.type;
  host.position.set(
    object.col + size.width / 2 + offset.x,
    0,
    object.row + size.height / 2 + offset.z,
  );
  host.rotation.y = angles[direction];
  attachFurnitureSeats(host, object, objects);
  if (object.type === "chair") {
    const seat = resolveSeat(object, objects);
    host.position.set(seat.x, 0, seat.z);
  }
  const loads: Promise<boolean>[] = [];
  if (directorFurniture) {
    const body = buildRoomFurniture(object.type, true) ?? new T.Group();
    if (object.type === "computer")
      addOfficeDetails(body, "computer", "#5a3425", "#efe5d3", false, "executive");
    host.add(body);
    const asset = {
      executive_desk: "executive-desk",
      chair: object.col === 3 && object.row === 12 ? "chair" : "guest-chair",
      bookshelf: "bookcase",
      office_sofa: "sofa",
      office_armchair: "armchair",
      meeting_table: "coffee",
    }[object.type] as ExecutiveAsset | undefined;
    if (asset) loads.push(attachFurnitureAsset(body, asset, options.load));
  }
  if (selection && (!kit || !creativeStudioKitOwnsBody(kit))) {
    const body = new T.Group();
    body.name = "shared-furniture-body";
    body.add(buildStudioFurnitureFallback(object.type, object.variant)!);
    host.add(body);
    const variant =
      object.type === "chair" && object.variant === "side-neutral"
        ? ["coral", "off-white", "teal", "mustard"][(object.col + object.row) % 4]
        : selection.variant;
    loads.push(attachSceneAsset(body, selection.id, { ...options, variant }));
  }
  if (kit) loads.push(attachCreativeStudioKit(host, object, options));
  if (plant) {
    const body = plantFallback(object.variant);
    host.add(body);
    if (object.variant === "monstera") loads.push(Promise.resolve(true));
    else
      loads.push(
        attachSceneAsset(
          body,
          object.variant === "olive" ? "shared-olive" : "shared-ficus",
          options,
        ),
      );
  }
  if (roomFurniture) host.add(buildRoomFurniture(object.type)!);
  host.userData.assetStatus = "loading";
  host.userData.dynamicAsset = true;
  host.userData.assetReady = Promise.all(loads).then((results) => {
    const ok = results.every(Boolean);
    host.userData.assetStatus = ok ? "ready" : "failed";
    return ok;
  });
  return true;
}
export type StudioDecoration = {
  id: SceneAssetId;
  position: readonly [number, number, number];
  scale?: readonly [number, number, number];
  variant?: string;
};
/** Floor plants occupy existing perimeter cells; tabletop plants remain over solid furniture. */
export function studioDecorations(
  objects: MapObject[],
  includeDirectorSuite = true,
): StudioDecoration[] {
  const out: StudioDecoration[] = [
    {
      id: "shared-round-rug",
      position: [14.5, 0.037, 12.5],
      scale: [1.42, 1, 1.42],
      variant: "mustard",
    },
    {
      id: "shared-woven-rug",
      position: [26.1, 0.037, 10],
      scale: [1.12, 1, 1.5],
      variant: "off-white",
    },
    {
      id: "shared-woven-rug",
      position: [36.5, 0.037, 22],
      scale: [1.02, 1, 1.03],
      variant: "neutral",
    },
    { id: "shared-woven-rug", position: [37, 0.037, 5], scale: [1.25, 1, 1.4], variant: "neutral" },
  ];
  if (includeDirectorSuite)
    out.push(
      { id: "executive-rug", position: [4.5, 0.037, 14.8], scale: [0.78, 1, 0.78] },
      {
        id: "shared-woven-rug",
        position: [4.8, 0.037, 20],
        scale: [0.85, 1, 0.78],
        variant: "neutral",
      },
    );
  for (const x of [4, 10, 18, 23, 29, 31, 40])
    out.push({ id: x % 2 ? "shared-olive" : "shared-ficus", position: [x + 0.5, 0.035, 0.62] });
  for (const z of [11, 18, 23]) out.push({ id: "shared-ficus", position: [0.5, 0.035, z + 0.5] });
  for (const o of objects.filter((o) => o.type === "studio_shelf" && o.variant !== "equipment")) {
    const size = getObjectDimensions(o.type, o.direction);
    out.push({
      id: "shared-ficus",
      position: [o.col + size.width - 0.25, 1.058, o.row + size.height / 2],
      scale: [0.27, 0.27, 0.27],
    });
  }
  out.push({ id: "shared-olive", position: [20.32, 0.866, 18.35], scale: [0.25, 0.25, 0.25] });
  return out;
}
/** After all loads settle, resource ownership moves from independent hosts to the whole scene. */
/** 바이트 배열을 한 번 훑어 32비트로 접는다. 같은 바이트면 같은 값이다. */
function fnv1a(bytes: ArrayLike<number>) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function finalizeStudioScene(root: T.Group) {
  /**
   * 같은 그림인지 픽셀을 구워서 비교하지 않는다.
   *
   * 예전에는 이미지를 캔버스에 그려 `toDataURL()` 로 base64 PNG 를 만들어 키로 썼고, 텍스처
   * 신호도 `Texture.toJSON()` 으로 만들어 three 가 이미지를 한 번 더 인코딩했다. 2048×1024 한
   * 장이 20~30ms 다. 픽셀 배열을 가진 텍스처는 바이트를 접어서 그대로 비교하고(정확도 유지),
   * 이미지 객체는 URL 이나 `Source` uuid 로 가른다 — 같은 GLB 를 복제한 텍스처는 source 를
   * 공유하므로 중복 제거가 성립한다.
   */
  const imageKeys = new WeakMap<object, string>();
  const imageKey = (texture: T.Texture) => {
    const source = texture.image as
      | {
          data?: ArrayLike<number>;
          width?: number;
          height?: number;
          src?: string;
          currentSrc?: string;
        }
      | undefined;
    if (!source || typeof source !== "object") return texture.source.uuid;
    const cached = imageKeys.get(source);
    if (cached) return cached;
    const key =
      source.data !== undefined
        ? `${source.width}x${source.height}:${source.data.length}:${fnv1a(source.data)}`
        : source.src || source.currentSrc || texture.source.uuid;
    imageKeys.set(source, key);
    return key;
  };
  /** 공유 판정에 실제로 쓰이는 샘플링 설정만 모은다. 픽셀은 보지 않는다. */
  const textureSignature = (texture: T.Texture) =>
    JSON.stringify([
      texture.mapping,
      texture.wrapS,
      texture.wrapT,
      texture.magFilter,
      texture.minFilter,
      texture.anisotropy,
      texture.format,
      texture.internalFormat,
      texture.type,
      texture.colorSpace,
      texture.flipY,
      texture.premultiplyAlpha,
      texture.unpackAlignment,
      texture.generateMipmaps,
      texture.offset.x,
      texture.offset.y,
      texture.repeat.x,
      texture.repeat.y,
      texture.rotation,
      texture.center.x,
      texture.center.y,
      texture.channel,
    ]);
  const textures = new Map<string, T.Texture>(),
    retired = new Set<T.Texture>();
  root.traverse((o) => {
    if (o.userData.assetStatus !== "loading") delete o.userData.dynamicAsset;
    if (!(o instanceof T.Mesh)) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (
      materials.every(
        (m) => m.name === "paper" || m.name === "printed-paper" || m.name.startsWith("accent-"),
      )
    )
      o.castShadow = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      for (const [key, value] of Object.entries(m)) {
        if (!(value instanceof T.Texture)) continue;
        const signature = textureSignature(value) + imageKey(value),
          shared = textures.get(signature);
        if (shared && shared !== value) {
          (m as unknown as Record<string, unknown>)[key] = shared;
          retired.add(value);
        } else if (!shared) textures.set(signature, value);
      }
  });
  retired.forEach((t) => t.dispose());
  batchStaticFurniture(root, true, { vertexColors: true, batchSeats: true });
  batchCoplanarGlass(root);
}
export function addCreativeStudioScene(
  root: T.Group,
  map: MapSnapshot,
  options: StudioOptions = {},
): T.Group | null {
  if (!isCreativeStudioMap(map)) return null;
  const existing = root.children.find((o) => o.name === "creative-studio-scene");
  if (existing) return existing as T.Group;
  const scene = new T.Group();
  scene.name = "creative-studio-scene";
  scene.userData.assetStatus = "loading";
  scene.userData.unhandledObjects = [] as MapObject[];
  root.add(scene);
  let disposed = false;
  scene.userData.disposeActor = () => {
    disposed = true;
  };
  const includeDirectorSuite = (map.environmentVersion ?? 0) >= 5;
  const architecture = addCreativeStudioArchitecture(scene, map.cols, map.rows, {
      ...options,
      includeDirectorSuite,
    }),
    loads: Promise<boolean>[] = [architecture.userData.assetReady];
  scene.userData.meetingWalls = architecture.userData.meetingWalls;
  for (const object of map.objects) {
    const host = new T.Group();
    if (renderCreativeStudioObject(host, object, map.objects, options)) {
      scene.add(host);
      loads.push(host.userData.assetReady);
    } else scene.userData.unhandledObjects.push(object);
  }
  for (const d of creativeStudioDecorations()) {
    // 벽 게시판은 공통 상호작용 모듈에서 렌더링한다.
    if (d.object.type === "studio_art_wall") continue;
    const host = new T.Group();
    const [x, y, z] = d.position;
    host.position.set(x, y, z);
    host.rotation.y = d.rotationY;
    scene.add(host);
    loads.push(attachCreativeStudioKit(host, d.object, options));
  }
  for (const d of studioDecorations(map.objects, includeDirectorSuite)) {
    const host = new T.Group();
    host.name = `decoration:${d.id}`;
    host.position.set(...d.position);
    if (d.scale) host.scale.set(...d.scale);
    if (d.id === "shared-ficus" || d.id === "shared-olive") host.add(plantFallback());
    else
      host.add(
        buildStudioFurnitureFallback(
          d.id === "shared-round-rug" ? "studio_round_rug" : "studio_woven_rug",
          d.variant,
        )!,
      );
    scene.add(host);
    loads.push(attachSceneAsset(host, d.id, { ...options, variant: d.variant }));
  }
  scene.userData.assetReady = Promise.all(loads).then((results) => {
    if (disposed) return false;
    scene.userData.assetStatus = results.every(Boolean) ? "ready" : "failed";
    finalizeStudioScene(scene);
    return results.every(Boolean);
  });
  return scene;
}
