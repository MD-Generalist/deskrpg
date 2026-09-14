import { sceneAsset, studioFurnitureAsset } from "./scene-asset-definitions";
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
/** Catalog anchors are integer tile offsets; visual poses are model-local meters. */
export function assetSeats(object: MapObject): Seat[] {
  const selected = studioFurnitureAsset(object);
  if (!selected) return [];
  const definition = sceneAsset(selected.id);
  if (!definition.seats) return [];
  const direction = object.direction ?? "down";
  const directions = ["down", "right", "up", "left"] as const;
  const turn = directions.indexOf(direction);
  const [width, depth] = definition.footprint;
  const rotated = turn % 2 === 1;
  const cx = object.col + (rotated ? depth : width) / 2,
    cz = object.row + (rotated ? width : depth) / 2;
  const rotate = (x: number, z: number): [number, number] =>
    turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : turn === 3 ? [-z, x] : [x, z];
  const offset = furnitureOffset(object);
  return definition.seats.map((seat) => {
    const [ax, az] = rotate(seat.anchor[0] + 0.5 - width / 2, seat.anchor[1] + 0.5 - depth / 2);
    const [vx, vz] = rotate(seat.visual[0], seat.visual[2]);
    return {
      anchorX: cx + ax,
      anchorZ: cz + az,
      x: cx + vx + offset.x,
      z: cz + vz + offset.z,
      elevation: seat.actorElevation ?? 0,
      direction: directions[(directions.indexOf(seat.direction) + turn) % 4],
    };
  });
}

function adjacentTable(chair: MapObject, objects: MapObject[]) {
  const x = chair.col + 0.5,
    z = chair.row + 0.5;
  let nearest: MapObject | undefined,
    distance = Infinity;
  for (const object of objects) {
    if (
      !object.type.includes("desk") &&
      object.type !== "meeting_table" &&
      object.type !== "conference_table" &&
      object.type !== "studio_round_table" &&
      object.type !== "studio_worktable"
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
  const x = chair.col + 0.5,
    z = chair.row + 0.5;
  // A wide table's corner chair still faces the adjacent edge, not its distant center.
  if (x >= table.col && x <= table.col + size.width) return z < table.row ? "down" : "up";
  if (z >= table.row && z <= table.row + size.height) return x < table.col ? "right" : "left";
  const dx = table.col + size.width / 2 - x;
  const dz = table.row + size.height / 2 - z;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
}
export function resolveSeat(chair: MapObject, objects: MapObject[]): Seat {
  const anchorX = chair.col + 0.5,
    anchorZ = chair.row + 0.5;
  const catalogSeat = assetSeats(chair)[0];
  const table = adjacentTable(chair, objects);
  if (!table)
    return (
      catalogSeat ?? {
        x: anchorX,
        z: anchorZ,
        anchorX,
        anchorZ,
        direction: chair.direction ?? "down",
      }
    );
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
    ...(catalogSeat ?? {}),
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
  const catalog = assetSeats(object);
  if (catalog.length) return catalog;
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
    return table &&
      ["meeting_table", "conference_table", "studio_round_table", "studio_worktable"].includes(
        table.type,
      )
      ? [resolveSeat(object, objects)]
      : [];
  });
}
