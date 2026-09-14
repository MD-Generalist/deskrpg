import type { MapObject } from "../../lib/object-types";

// Shared by furniture rendering and seat poses. Navigation anchors remain in
// the clear aisle tiles; small furniture offsets refine the miniature layout.
export const EXECUTIVE_LOUNGE_RUG = { x: 12, z: 14, width: 6, depth: 6 };
export function furnitureOffset(object: MapObject) {
  if (object.variant !== "executive-lounge") return { x: 0, z: 0 };
  if (object.type === "office_sofa") return { x: 0, z: 0.35 };
  if (object.type === "office_armchair")
    return { x: object.direction === "right" ? 0.55 : -0.55, z: 0.5 };
  return { x: 0, z: 0 };
}
