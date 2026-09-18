import type { TiledMap, TiledObject } from "../../lib/tiled-map";
import { getObjectDimensions } from "../../lib/object-types";
export type OfficePreset = "blank" | "garden" | "courtyard" | "cafe" | "trading";
/** New-project templates only. Existing channel/project data is never replaced automatically. */
export function applyOfficePreset(map: TiledMap, preset: OfficePreset): TiledMap {
  if (preset === "blank") return map;
  if (map.width < 20 || map.height < 15)
    throw new Error("Office presets require at least 20 × 15 tiles");
  const result = structuredClone(map),
    objects: TiledObject[] = [];
  let nextId = result.nextobjectid;
  const add = (type: string, col: number, row: number) => {
    const dimensions = preset === "trading" ? getObjectDimensions(type) : { width: 1, height: 1 };
    objects.push({
      id: nextId++,
      name: type,
      type,
      x: col * 32,
      y: row * 32,
      width: dimensions.width * 32,
      height: dimensions.height * 32,
      visible: true,
    });
  };
  // Cutaway perimeter; a three-tile entrance at the bottom stays clear.
  const middle = Math.floor(map.width / 2);
  for (let x = 0; x < map.width; x++) {
    add("cubicle_wall", x, 0);
    if (Math.abs(x - middle) > 1) add("cubicle_wall", x, map.height - 1);
  }
  for (let y = 1; y < map.height - 1; y++) {
    add("cubicle_wall", 0, y);
    add("cubicle_wall", map.width - 1, y);
  }
  if (preset === "trading") {
    // Paired desk islands, with a full row behind each chair and a central aisle.
    for (let x = 3; x + 1 < middle - 1; x += 4)
      for (let y = 5; y <= map.height - 6; y += 4)
        for (const col of [x, x + 1]) {
          add("desk", col, y);
          add("computer", col, y);
          add("chair", col, y + 1);
        }
    // Shared archives line the back wall, leaving row two open for access.
    for (let x = 3; x <= middle - 3; x++) add("bookshelf", x, 1);
    // Leader's larger desk at the back right, with room for visitors.
    add("reception_desk", middle + 3, 3);
    add("computer", middle + 3, 3);
    add("chair", middle + 3, 4);
    add("chair", middle + 5, 4);
    add("whiteboard", map.width - 3, 1);
    // Meeting table occupies its real two-by-two footprint; seats stay outside it.
    add("meeting_table", middle + 3, 7);
    add("chair", middle + 2, 7);
    add("chair", middle + 5, 7);
    add("chair", middle + 3, 6);
    add("chair", middle + 4, 9);
    // Pantry faces the open entrance lobby at the front right.
    add("coffee", middle + 3, map.height - 3);
    add("water_cooler", middle + 5, map.height - 3);
    add("bookshelf", middle + 7, map.height - 3);
  } else if (preset === "garden") {
    for (const x of [4, 8, 12])
      for (const y of [4, 8]) {
        add("desk", x, y);
        add("computer", x, y);
        add("chair", x, y + 1);
      }
    add("meeting_table", map.width - 5, 4);
    add("chair", map.width - 6, 4);
    add("chair", map.width - 3, 4);
    add("bookshelf", 3, 1);
    add("bookshelf", 4, 1);
    add("coffee", map.width - 3, map.height - 3);
  } else if (preset === "cafe") {
    for (const x of [4, 9, 14])
      for (const y of [4, 9]) {
        add("meeting_table", x, y);
        add("chair", x - 1, y);
        add("chair", x + 2, y);
      }
    for (let x = 3; x < 8; x += 2) add("reception_desk", x, 1);
    add("coffee", 10, 1);
    add("water_cooler", 12, 1);
  } else {
    for (const x of [3, 4, 5, map.width - 6, map.width - 5, map.width - 4]) {
      add("plant", x, 4);
      add("plant", x, 8);
    }
    add("meeting_table", middle - 1, 5);
    add("chair", middle - 2, 5);
    add("chair", middle + 1, 5);
    add("desk", 4, map.height - 4);
    add("chair", 4, map.height - 3);
    add("desk", map.width - 5, map.height - 4);
    add("chair", map.width - 5, map.height - 3);
  }
  for (const x of [1, map.width - 2]) for (const y of [1, map.height - 2]) add("plant", x, y);
  let layer = result.layers.find(
    (l) => l.type === "objectgroup" && l.name.toLowerCase() === "objects",
  );
  if (!layer) {
    layer = {
      id: result.nextlayerid++,
      name: "Objects",
      type: "objectgroup",
      objects: [],
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    };
    result.layers.push(layer);
  }
  layer.objects = [
    ...(layer.objects || []).filter((o) => o.type !== "spawn" && o.name !== "spawn"),
    ...objects,
    {
      id: nextId++,
      name: "spawn",
      type: "spawn",
      x: middle * 32,
      y: (map.height - 3) * 32,
      width: 32,
      height: 32,
      visible: true,
    },
  ];
  result.nextobjectid = nextId;
  return result;
}
