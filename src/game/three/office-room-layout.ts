import type { MapObject } from "../../lib/object-types";
import { EXECUTIVE_ZONES, furnishExecutiveOffice } from "./executive-room-layout";
import { PUBLISHING_ROOMS, furnishPublishingRooms } from "./publishing-room-layout";

export interface OfficeRoom {
  id: "ceo" | "meeting" | "pantry";
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  door: number;
  color: string;
}
const names = { ceo: "대표실", meeting: "미팅룸", pantry: "탕비실" };
const colors = { ceo: "#ba9b74", meeting: "#a7b4af", pantry: "#d4cdbb" };
function suite(depth: number, entries: [OfficeRoom["id"], number][]): readonly OfficeRoom[] {
  let x = 1;
  return entries.map(([id, width]) => {
    const room = {
      id,
      label: names[id],
      x,
      z: 1,
      width,
      depth,
      door: x + Math.floor(width / 2) - 1,
      color: colors[id],
    };
    x += width + 1;
    return room;
  });
}
/** Shared source for physical partitions, finishes, navigation and ambient policy. */
export const OFFICE_ROOMS: Record<string, readonly OfficeRoom[]> = {
  publishing: PUBLISHING_ROOMS,
  trading: suite(7, [
    ["pantry", 8],
    ["meeting", 10],
    ["ceo", 8],
  ]),
  tech: suite(7, [
    ["meeting", 10],
    ["pantry", 9],
    ["ceo", 7],
  ]),
  executive: EXECUTIVE_ZONES,
};
/** Frozen source of the retired official map. Task 7 uses this to recognize agency v2 exactly. */
export const LEGACY_AGENCY_V2_ROOMS: readonly OfficeRoom[] = Object.freeze(
  suite(8, [
    ["ceo", 7],
    ["meeting", 12],
    ["pantry", 7],
  ]).map((room) => Object.freeze(room)),
);

export type OfficeRoomSurfaceContext = {
  environmentVersion?: number;
  hasLegacyPartitions?: boolean;
};

/** Keep retired agency rooms available only to persisted legacy presentation. */
export function officeRoomsForSurface(
  environment: string,
  context: OfficeRoomSurfaceContext = {},
): readonly OfficeRoom[] | undefined {
  if (
    (environment === "tech" || environment === "trading" || environment === "publishing") &&
    (context.environmentVersion ?? 2) >= 3
  )
    return undefined;
  if (environment !== "agency") return OFFICE_ROOMS[environment];
  if (context.hasLegacyPartitions !== true) return undefined;
  return context.environmentVersion === 2 || context.environmentVersion === undefined
    ? LEGACY_AGENCY_V2_ROOMS
    : undefined;
}

type RoomAdd = (type: string, x: number, y: number, direction?: MapObject["direction"]) => void;

export function furnishOfficeRooms(id: string, add: RoomAdd) {
  if (id === "executive") return furnishExecutiveOffice(add);
  if (id === "publishing") return furnishPublishingRooms(add);
  const rooms = OFFICE_ROOMS[id];
  if (!rooms) throw new Error(`No shared office-room layout for ${id}`);
  furnishStandardSuite(id, rooms, add);
}

/** Recreates only the v2 agency furniture; it is not used by selectable environments. */
export function furnishLegacyAgencyV2(add: RoomAdd) {
  furnishStandardSuite("agency", LEGACY_AGENCY_V2_ROOMS, add);
}

function furnishStandardSuite(id: string, rooms: readonly OfficeRoom[], add: RoomAdd) {
  const boundary = rooms[0].z + rooms[0].depth;
  for (const room of rooms) {
    if (room.x > 1) for (let z = 1; z <= boundary; z++) add("room_wall_v", room.x - 1, z);
    for (let x = room.x; x < room.x + room.width; x++)
      if (x !== room.door && x !== room.door + 1) add("room_wall_h", x, boundary);
    const x = room.x;
    if (room.id === "ceo") {
      desk(x + 2, 2);
      add("low_cabinet", x + room.width - 3, 1);
      add("floor_lamp", x, 1);
      add("office_sofa", x + 1, 5);
      if (room.width >= 8) add("office_armchair", x + room.width - 2, 5);
    } else if (room.id === "meeting") {
      const table = x + Math.floor((room.width - 4) / 2);
      add("conference_table", table, 4);
      add("meeting_display", table + 1, 1);
      for (const seat of [table, table + 3]) {
        add("chair", seat, 3);
        add("chair", seat, 6);
      }
      add("chair", table - 1, 4);
      add("chair", table + 4, 4);
      add("whiteboard", x + room.width - 1, 2);
    } else {
      add("refrigerator", x, 1);
      add("kitchen_counter", x + 1, 1);
      add("microwave_cabinet", x + 3, 1);
      add("coffee", x + 4, 1);
      add("recycling_bins", x + room.width - 1, 3);
      add("meeting_table", x + 2, 4);
      add("chair", x + 1, 4);
      add("chair", x + 4, 4);
    }
  }
  function desk(x: number, z: number) {
    add("desk", x, z);
    add("computer", x, z);
    add("chair", x, z + 1);
  }
  const start = boundary + 3; // Two full-width corridor rows before any workstation.
  if (id === "trading") {
    for (const x of [4, 5, 11, 12, 20, 21]) for (const z of [start, start + 3]) desk(x, z);
    add("office_printer", 26, start);
    add("low_cabinet", 26, start + 3);
  } else if (id === "agency") {
    for (const x of [4, 12, 22]) {
      add("meeting_table", x, start + 1);
      add("chair", x - 1, start + 1);
      add("chair", x + 2, start + 1);
      add("chair", x, start);
      add("chair", x + 1, start + 3);
      add("whiteboard", x + 3, start);
    }
    for (const x of [4, 10, 22]) desk(x, 17);
  } else if (id === "tech") {
    for (const x of [3, 4, 8, 9, 19, 20, 24, 25]) for (const z of [start, start + 3]) desk(x, z);
    for (const x of [12, 16]) add("whiteboard", x, start);
    add("office_locker", 27, 17);
    add("office_locker", 28, 17);
  } else {
    for (const x of [4, 24]) desk(x, start);
    add("office_sofa", 10, start);
    add("office_sofa", 18, start);
    add("meeting_table", 14, start + 1);
    add("chair", 13, start + 1);
    add("chair", 16, start + 1);
    add("low_cabinet", 4, 16);
    add("low_cabinet", 24, 16);
  }
  add("reception_desk", 5, 19);
  add("chair", 5, 20);
  add("office_sofa", 21, 19);
  add("office_armchair", 24, 19);
  add("coat_rack", 10, 19);
}
