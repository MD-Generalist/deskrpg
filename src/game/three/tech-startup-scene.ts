import type { MapObject } from "../../lib/object-types";
import { TECH_STARTUP_BOUNDARIES } from "./tech-startup-layout";
import * as T from "three";
import type { MapSnapshot } from "./bridge";
import { round } from "./primitives";
import { surfaceTexture } from "./surface-detail";

export function isTechStartupMap(map: Pick<MapSnapshot, "environment" | "environmentVersion">) {
  return map.environment === "tech" && (map.environmentVersion ?? 0) >= 3;
}
/** Scene-owned deterministic concrete: aggregate pores, broad mottling and roughness. */
export function concreteTexture() {
  const size = 256,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const grain = (n - Math.floor(n)) * 7;
      const cloud = Math.sin((x / size) * Math.PI * 8) * Math.cos((y / size) * Math.PI * 6) * 3;
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 231 + grain + cloud;
      pixels[i + 3] = 255;
    }
  const texture = new T.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(12, 6);
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
export function addTechStartupSurfaces(root: T.Group, map: MapSnapshot) {
  const grain = concreteTexture();
  const material = new T.MeshStandardMaterial({
    color: "#aeb4b8",
    map: grain,
    bumpMap: grain,
    bumpScale: 0.035,
    roughness: 0.57,
    metalness: 0.025,
  });
  const floor = new T.Mesh(new T.PlaneGeometry(map.cols, map.rows), material);
  floor.name = "tech-polished-concrete";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(map.cols / 2, 0.005, map.rows / 2);
  floor.receiveShadow = true;
  root.add(floor);
  for (let x = 2; x < map.cols; x += 4)
    round(root, 0.009, 0.004, map.rows, "#aeb4b4", x, 0.008, map.rows / 2, 0.001);
  for (let z = 2; z < map.rows; z += 4)
    round(root, map.cols, 0.004, 0.009, "#aeb4b4", map.cols / 2, 0.008, z, 0.001);
  for (const [x, z, w, d, color] of [
    [29, 4.2, 6, 3.5, "#64849a"],
    [37.8, 14.2, 8.5, 7.5, "#d6d3c8"],
  ] as const) {
    const weave = surfaceTexture("fabric");
    weave.repeat.set(w * 2, d * 2);
    const rug = new T.Mesh(
      new T.BoxGeometry(w, 0.024, d),
      new T.MeshStandardMaterial({ color, bumpMap: weave, bumpScale: 0.015, roughness: 0.96 }),
    );
    rug.position.set(x, 0.022, z);
    rug.receiveShadow = true;
    root.add(rug);
  }
}

/** Close half-cell gaps at perimeter/corners without changing navigation cells. */
export function techPartitionSpan(object: MapObject) {
  const vertical = object.direction === "right";
  let x = object.col + 0.5,
    z = object.row + 0.5,
    length = 1;
  for (const room of Object.values(TECH_STARTUP_BOUNDARIES)) {
    if (vertical && (object.col === room.westCol || object.col === room.eastCol)) {
      if (object.row === 1) {
        z -= 0.25;
        length += 0.5;
      }
      if (object.row === room.frontRow - 1) {
        z += 0.25;
        length += 0.5;
      }
    } else if (!vertical && object.row === room.frontRow) {
      if (object.col === room.westCol + 1) {
        x -= 0.25;
        length += 0.5;
      }
      if (object.col === room.eastCol) {
        x -= 0.25;
        length -= 0.5;
      }
    }
  }
  return { x, z, length, vertical };
}
