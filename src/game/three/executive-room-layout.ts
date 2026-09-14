import type { MapObject } from "../../lib/object-types";
/** Open reference suite. Coordinates also drive collision and ambient ownership. */
export const EXECUTIVE_ZONES = [
  { id: "ceo", label: "대표 업무석", x: 2, z: 3, width: 7, depth: 7, door: 5, color: "#a28b70" },
  {
    id: "meeting",
    label: "라운드 미팅",
    x: 10,
    z: 3,
    width: 7,
    depth: 6,
    door: 13,
    color: "#cbbda6",
  },
  {
    id: "pantry",
    label: "응접 라운지",
    x: 9,
    z: 10,
    width: 7,
    depth: 6,
    door: 12,
    color: "#b8a083",
  },
] as const;
export function furnishExecutiveOffice(
  add: (type: string, x: number, z: number, direction?: MapObject["direction"]) => void,
) {
  for (const x of [7, 8, 9, 10]) add("bookshelf", x, 1);
  add("executive_desk", 3, 6);
  add("computer", 3, 6);
  add("chair", 4, 5);
  add("chair", 3, 8);
  add("chair", 6, 8);
  // Reception beside the entry, leaving the central arrival aisle open.
  add("reception_desk", 3, 14);
  add("computer", 3, 14);
  add("chair", 3, 13);
  add("conference_table", 11, 5);
  for (const x of [11, 14]) {
    add("chair", x, 4);
    add("chair", x, 7);
  }
  add("chair", 10, 5);
  add("chair", 15, 5);
  add("office_sofa", 11, 11);
  add("meeting_table", 11, 13);
  add("office_armchair", 9, 13, "right");
  add("office_armchair", 14, 13, "left");
  add("low_cabinet", 15, 9);
  add("plant", 2, 2);
  add("plant", 15, 2);
  add("plant", 2, 14);
}
