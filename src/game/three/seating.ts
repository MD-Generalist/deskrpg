import { furnitureOffset } from "./executive-lounge-layout";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
export type Seat = {
  elevation?: number;
  x: number;
  z: number;
  /** Navigation/storage keep their original tile center despite visual alignment. */
  anchorX?: number;
  anchorZ?: number;
  direction: NonNullable<MapObject["direction"]>;
};
function adjacentTable(chair: MapObject, objects: MapObject[]) {
  const x = chair.col + 0.5,
    z = chair.row + 0.5;
  let nearest: MapObject | undefined,
    distance = Infinity;
  for (const object of objects) {
    if (
      !object.type.includes("desk") &&
      object.type !== "meeting_table" &&
      object.type !== "conference_table"
    )
      continue;
    const size = getObjectDimensions(object.type, object.direction);
    const dx = Math.max(object.col - x, 0, x - object.col - size.width);
    const dz = Math.max(object.row - z, 0, z - object.row - size.height);
    const next = Math.hypot(dx, dz);
    if (next <= 0.8 && next < distance) {
      nearest = object;
      distance = next;
    }
  }
  return nearest;
}
function tableSide(chair: MapObject, table: MapObject) {
  const size = getObjectDimensions(table.type, table.direction);
  const dx = table.col + size.width / 2 - chair.col - 0.5;
  const dz = table.row + size.height / 2 - chair.row - 0.5;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
}
export function resolveSeat(chair: MapObject, objects: MapObject[]): Seat {
  const anchorX = chair.col + 0.5,
    anchorZ = chair.row + 0.5;
  const table = adjacentTable(chair, objects);
  if (!table)
    return { x: anchorX, z: anchorZ, anchorX, anchorZ, direction: chair.direction ?? "down" };
  const side = tableSide(chair, table);
  const horizontal = side === "up" || side === "down";
  const peers = objects.filter(
    (o) =>
      o.type === "chair" &&
      o.id !== chair.id &&
      adjacentTable(o, objects)?.id === table.id &&
      tableSide(o, table) === side,
  );
  peers.push(chair);
  peers.sort((a, b) => (horizontal ? a.col - b.col : a.row - b.row) || a.id.localeCompare(b.id));
  const size = getObjectDimensions(table.type, table.direction);
  // Center a single chair; evenly space multiple chairs along the same table edge.
  const offset = (peers.findIndex((o) => o.id === chair.id) + 1) / (peers.length + 1);
  return {
    x: horizontal ? table.col + size.width * offset : anchorX,
    z: horizontal ? anchorZ : table.row + size.height * offset,
    anchorX,
    anchorZ,
    direction: chair.direction ?? side,
  };
}
export function seatAt(seats: Seat[], x: number, z: number, walking: boolean) {
  if (walking) return undefined;
  return seats.find(
    (seat) => Math.hypot((seat.anchorX ?? seat.x) - x, (seat.anchorZ ?? seat.z) - z) <= 0.22,
  );
}

// Supplied sit clips put the rear of the shortest calf ~0.135 m ahead of
// the actor origin. Keep it beyond the sofa body front (+0.41 m), including
// a small clearance. This is visual only: saved navigation anchors stay put.
export const SOFA_SEATED_FORWARD = 0.3;
export function sofaSeats(object: MapObject): Seat[] {
  const count = object.type === "office_sofa" ? 2 : object.type === "office_armchair" ? 1 : 0;
  const direction = object.direction ?? "down";
  const size = getObjectDimensions(object.type, direction);
  const angle = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[direction];
  const cx = object.col + size.width / 2,
    cz = object.row + size.height / 2;
  const transform = (x: number, z: number) => ({
    x: cx + x * Math.cos(angle) + z * Math.sin(angle),
    z: cz - x * Math.sin(angle) + z * Math.cos(angle),
  });
  return Array.from({ length: count }, (_, i) => {
    const point = transform(count === 2 ? (i === 0 ? -0.38 : 0.38) : 0, SOFA_SEATED_FORWARD);
    const anchor = transform(count === 2 ? (i === 0 ? -0.5 : 0.5) : 0, 1);
    const offset = furnitureOffset(object);
    return {
      x: point.x + offset.x,
      z: point.z + offset.z,
      anchorX: Math.round(anchor.x * 2) / 2,
      anchorZ: Math.round(anchor.z * 2) / 2,
      direction,
      elevation: 0.055,
    };
  });
}
export function furnitureSeats(objects: MapObject[]) {
  return objects.flatMap((object) =>
    object.type === "chair" ? [resolveSeat(object, objects)] : sofaSeats(object),
  );
}
export function isSeatAnchor(objects: MapObject[], col: number, row: number) {
  return furnitureSeats(objects).some(
    (seat) => seat.anchorX === col + 0.5 && seat.anchorZ === row + 0.5,
  );
}

/** Shared tables and lounge furniture, excluding individual desk chairs. */
export function commonAreaSeats(objects: MapObject[]) {
  return objects.flatMap((object) => {
    if (object.type !== "chair") return sofaSeats(object);
    const table = adjacentTable(object, objects);
    return table && ["meeting_table", "conference_table"].includes(table.type)
      ? [resolveSeat(object, objects)]
      : [];
  });
}
