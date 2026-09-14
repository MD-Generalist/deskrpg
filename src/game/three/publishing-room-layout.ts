/** Shared room footprints are also used for floor finishes and door frames. */
export const PUBLISHING_ROOMS = [
  { id: "ceo", label: "대표실", x: 1, z: 1, width: 8, depth: 7, door: 4, color: "#ba9b74" },
  { id: "meeting", label: "미팅룸", x: 10, z: 1, width: 10, depth: 7, door: 14, color: "#a7b4af" },
  { id: "pantry", label: "탕비실", x: 21, z: 1, width: 8, depth: 7, door: 24, color: "#d4cdbb" },
] as const;
export function furnishPublishingRooms(add: (type: string, x: number, y: number) => void) {
  for (const x of [9, 20]) for (let y = 1; y <= 8; y++) add("room_wall_v", x, y);
  for (const room of PUBLISHING_ROOMS)
    for (let x: number = room.x; x < room.x + room.width; x++)
      if (x !== room.door && x !== room.door + 1) add("room_wall_h", x, 8);
  const desk = (x: number, y: number) => {
    add("desk", x, y);
    add("computer", x, y);
    add("chair", x, y + 1);
  };
  desk(4, 2);
  add("low_cabinet", 6, 1);
  add("floor_lamp", 2, 1);
  add("office_sofa", 2, 5);
  add("meeting_table", 5, 5);
  add("chair", 7, 5);
  add("plant", 1, 7);
  add("meeting_display", 14, 1);
  add("conference_table", 13, 4);
  for (const x of [13, 16]) {
    add("chair", x, 3);
    add("chair", x, 6);
  }
  add("chair", 12, 4);
  add("chair", 17, 4);
  add("whiteboard", 18, 2);
  add("low_cabinet", 10, 1);
  add("plant", 19, 7);
  add("refrigerator", 21, 1);
  add("kitchen_counter", 22, 1);
  add("microwave_cabinet", 24, 1);
  add("coffee", 25, 1);
  add("cup_shelf", 26, 1);
  add("recycling_bins", 28, 1);
  add("water_cooler", 28, 3);
  add("meeting_table", 23, 4);
  add("chair", 22, 4);
  add("chair", 25, 4);
  add("plant", 28, 7);
  // A two-tile corridor remains empty at rows 9 and 10.
  for (const x of [8, 12, 17]) for (const y of [11, 14]) desk(x, y);
  for (const x of [2, 3, 4, 23, 24, 25, 26]) {
    add("bookshelf", x, 12);
    add("bookshelf", x, 15);
  }
  add("office_printer", 20, 12);
  add("low_cabinet", 20, 15);
  add("office_locker", 27, 17);
  add("office_locker", 28, 17);
  add("reception_desk", 5, 18);
  add("chair", 5, 19);
  add("office_sofa", 21, 19);
  add("office_armchair", 24, 19);
  add("coat_rack", 11, 19);
}
