import { furnishOfficeRooms, OFFICE_ROOMS } from "./office-room-layout";
import {
  createDefaultMap,
  type TiledMap,
  type TiledObject,
} from "../../components/map-editor/hooks/useMapEditor";
import { getObjectDimensions } from "../../lib/object-types";

export const OFFICE_ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id: "trading",
    nameKo: "종합상사",
    nameEn: "Trading company",
    descriptionKo: "책상 섬과 임원석, 회의 공간이 어우러진 정통 오피스",
    descriptionEn: "A classic office with desk islands, a leader's desk and meeting space.",
    color: "#8F7152",
  }),
  Object.freeze({
    id: "agency",
    nameKo: "크리에이티브 에이전시",
    nameEn: "Creative agency",
    descriptionKo: "작은 팀 테이블과 아이디어 보드가 있는 열린 작업실",
    descriptionEn: "An open studio with team tables and idea boards.",
    color: "#C17B64",
  }),
  Object.freeze({
    id: "tech",
    nameKo: "테크 스타트업",
    nameEn: "Tech startup",
    descriptionKo: "집중 업무석과 스프린트 회의 공간을 갖춘 개발팀 오피스",
    descriptionEn: "A developer office with focused workstations and sprint meeting spaces.",
    color: "#648C86",
  }),
  Object.freeze({
    id: "executive",
    nameKo: "임원 오피스",
    nameEn: "Executive office",
    descriptionKo: "넓은 중앙 회의석과 독립 업무석을 갖춘 차분한 공간",
    descriptionEn: "A spacious boardroom with private work areas and a welcoming lobby.",
    color: "#596B61",
  }),
  Object.freeze({
    id: "publishing",
    nameKo: "출판사",
    nameEn: "Publishing house",
    descriptionKo: "서가 사이 편집석과 원고를 함께 읽는 테이블",
    descriptionEn:
      "Editorial desks among bookshelves, with tables for reading manuscripts together.",
    color: "#AA8659",
  }),
] as const);

export type OfficeEnvironmentId = (typeof OFFICE_ENVIRONMENTS)[number]["id"];

/** Fresh, deterministic standard Tiled maps. Calling this never edits an existing project. */
export function buildOfficeEnvironment(id: OfficeEnvironmentId): TiledMap {
  const environment = OFFICE_ENVIRONMENTS.find((entry) => entry.id === id);
  if (!environment) throw new Error(`Unknown office environment: ${id}`);
  const map = createDefaultMap(environment.nameEn, 30, 22, 32);
  const layer = map.layers.find((entry) => entry.name === "Objects")!;
  const objects: TiledObject[] = [];
  const add = (type: string, col: number, row: number) => {
    const size = getObjectDimensions(type);
    objects.push({
      id: map.nextobjectid++,
      name: type,
      type,
      x: col * 32,
      y: row * 32,
      width: size.width * 32,
      height: size.height * 32,
      visible: true,
    });
  };
  for (let x = 0; x < 30; x++) {
    add("cubicle_wall", x, 0);
    if (x < 14 || x > 16) add("cubicle_wall", x, 21);
  }
  for (let y = 1; y < 21; y++) {
    add("cubicle_wall", 0, y);
    add("cubicle_wall", 29, y);
  }
  furnishOfficeRooms(id, add);
  for (const x of [1, 28])
    for (const y of [1, 20]) {
      if (!objects.some((object) => object.x === x * 32 && object.y === y * 32)) add("plant", x, y);
    }
  add("spawn", 15, 19);
  layer.objects = objects;
  return tagEnvironment(map, id);
}

function tagEnvironment(map: TiledMap, id: OfficeEnvironmentId): TiledMap {
  const layer = map.layers.find((entry) => entry.name === "Objects")!;
  layer.properties = [
    ...(layer.properties || []),
    { name: "officeEnvironment", type: "string", value: id },
    ...[
      {
        name: "ambientZones",
        type: "string",
        value: JSON.stringify(
          OFFICE_ROOMS[id].map((room) => ({
            id: room.id,
            x: room.x,
            y: room.z,
            width: room.width,
            height: room.depth + 1,
            roaming: room.id !== "ceo",
          })),
        ),
      },
    ],
    { name: "officeEnvironmentVersion", type: "int", value: 2 },
  ];
  return map;
}
