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
/**
 * 좌석 계산은 한 맵당 한 번만 한다.
 *
 * `furnitureSeats` 는 의자마다 `resolveSeat` 를 부르고, 그 안에서 `adjacentTable` 이 모든
 * 오브젝트를 훑은 뒤 같은 테이블의 이웃 의자를 찾느라 `adjacentTable` 을 또 의자 수만큼 부른다.
 * 결과는 맵이 바뀌기 전까지 변하지 않는데, `isSeatAnchor` 가 타일 하나를 물어볼 때마다 이 전부를
 * 다시 계산했다. 캐릭터가 걷는 동안 그 질문이 매 프레임 나가면서(시뮬레이션의 도착 판정)
 * 실측 CPU 의 약 66% 를 여기서 썼고 프레임 중앙값이 8.7ms → 41.6ms 가 됐다.
 *
 * 캐시 키는 배열의 정체성과 길이다. 이 코드베이스에서 맵 오브젝트 배열은 통째로 교체되거나
 * `push`/`splice` 로 바뀌므로 둘 중 하나는 반드시 달라진다. 배열이 사라지면 항목도 함께 사라진다.
 */
const seatCache = new WeakMap<
  MapObject[],
  {
    length: number;
    seats: Seat[];
    anchors: Set<string>;
    desk: Seat[];
    deskAnchors: Set<string>;
    executive: Seat[];
  }
>();

/**
 * 대표석 — `executive_desk` 뒤편 의자. 책상이 바라보는 쪽을 같이 보는 의자가 주인 자리이고,
 * 맞은편(책상 앞) 의자는 손님 자리다. 대표석은 직원 지정석으로 내주지 않는다.
 */
function isExecutiveSeat(chair: MapObject, objects: MapObject[]) {
  const table = adjacentTable(chair, objects);
  return (
    table?.type === "executive_desk" && tableSide(chair, table) === (table.direction ?? "down")
  );
}

function anchorKey(col: number, row: number) {
  return `${col}:${row}`;
}

const seatIdentity = (seat: Seat) => `${seat.anchorX ?? seat.x}:${seat.anchorZ ?? seat.z}`;

function seatIndex(objects: MapObject[]) {
  const cached = seatCache.get(objects);
  if (cached && cached.length === objects.length) return cached;
  const executive: Seat[] = [];
  const seats = objects.flatMap((object) => {
    if (object.type !== "chair") return sofaSeats(object);
    const seat = resolveSeat(object, objects);
    if (isExecutiveSeat(object, objects)) executive.push(seat);
    return [seat];
  });
  const anchors = new Set(
    seats.map((seat) => anchorKey((seat.anchorX ?? seat.x) - 0.5, (seat.anchorZ ?? seat.z) - 0.5)),
  );
  // 데스크 좌석 = 전체에서 공용(회의 테이블·라운지)을 뺀 것. 자리 배정은 이것만 쓴다.
  // 대표석도 뺀다 — 1번 자리가 대표석이라 첫 직원이 대표 의자에 앉던 것을 막는다.
  const common = new Set(commonAreaSeats(objects).map(seatIdentity));
  const reserved = new Set(executive.map(seatIdentity));
  const desk = seats.filter(
    (seat) => !common.has(seatIdentity(seat)) && !reserved.has(seatIdentity(seat)),
  );
  const deskAnchors = new Set(
    desk.map((seat) =>
      anchorKey(Math.floor(seat.anchorX ?? seat.x), Math.floor(seat.anchorZ ?? seat.z)),
    ),
  );
  const entry = { length: objects.length, seats, anchors, desk, deskAnchors, executive };
  seatCache.set(objects, entry);
  return entry;
}

export function furnitureSeats(objects: MapObject[]) {
  return seatIndex(objects).seats;
}
export function isSeatAnchor(objects: MapObject[], col: number, row: number) {
  return seatIndex(objects).anchors.has(anchorKey(col, row));
}

/** 대표석 — 좌석이지만 직원에게 배정하지 않는다. */
export function executiveSeats(objects: MapObject[]) {
  return seatIndex(objects).executive;
}

/** 개인 데스크 의자 — 직원의 지정자리 후보. */
export function deskSeats(objects: MapObject[]) {
  return seatIndex(objects).desk;
}
export function isDeskSeatAnchor(objects: MapObject[], col: number, row: number) {
  return seatIndex(objects).deskAnchors.has(anchorKey(col, row));
}

/** 자리 변경 모드의 번호 라벨 — 데스크 좌석 타일을 row→col 로 세어 1부터. */
export function deskSeatLabels(
  objects: MapObject[],
  canStand: (col: number, row: number) => boolean,
  taken: (col: number, row: number) => boolean,
) {
  const tiles = new Map<string, { col: number; row: number }>();
  for (const seat of deskSeats(objects)) {
    const col = Math.floor(seat.anchorX ?? seat.x),
      row = Math.floor(seat.anchorZ ?? seat.z);
    if (canStand(col, row)) tiles.set(anchorKey(col, row), { col, row });
  }
  return [...tiles.values()]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((tile, index) => ({ ...tile, number: index + 1, taken: taken(tile.col, tile.row) }));
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
