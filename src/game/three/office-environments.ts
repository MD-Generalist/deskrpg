import {
  createDefaultMap,
  type TiledMap,
  type TiledObject,
} from "../../components/map-editor/hooks/useMapEditor";
import { getObjectDimensions } from "../../lib/object-types";
import { applyOfficePreset } from "./office-presets";

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
  if (id === "trading") return tagEnvironment(applyOfficePreset(map, "trading"), id);
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
  const workstation = (x: number, y: number) => {
    add("desk", x, y);
    add("computer", x, y);
    add("chair", x, y + 1);
  };
  const meeting = (x: number, y: number) => {
    add("meeting_table", x, y);
    add("chair", x - 1, y);
    add("chair", x + 2, y);
    add("chair", x, y - 1);
    add("chair", x + 1, y + 2);
  };
  for (let x = 0; x < 30; x++) {
    add("cubicle_wall", x, 0);
    if (x < 14 || x > 16) add("cubicle_wall", x, 21);
  }
  for (let y = 1; y < 21; y++) {
    add("cubicle_wall", 0, y);
    add("cubicle_wall", 29, y);
  }
  if (id === "agency") {
    for (const x of [5, 11, 21]) for (const y of [6, 13]) meeting(x, y);
    for (const x of [4, 7, 19, 22, 25]) workstation(x, 2);
    for (const x of [5, 12, 22]) add("whiteboard", x, 10);
    add("reception_desk", 5, 18);
    add("chair", 5, 19);
    add("bookshelf", 27, 5);
    add("bookshelf", 27, 6);
    add("coffee", 23, 18);
    add("water_cooler", 25, 18);
  } else if (id === "tech") {
    for (const x of [4, 5, 9, 10, 19, 20, 24, 25]) for (const y of [4, 8, 12]) workstation(x, y);
    meeting(5, 17);
    meeting(23, 17);
    for (const x of [4, 9, 20, 25]) add("whiteboard", x, 1);
    for (const x of [12, 13, 16, 17]) add("bookshelf", x, 1);
    add("coffee", 11, 18);
    add("water_cooler", 18, 18);
  } else if (id === "executive") {
    add("reception_desk", 14, 3);
    add("computer", 14, 3);
    add("chair", 14, 4);
    for (const x of [12, 14, 16]) {
      add("meeting_table", x, 8);
      add("chair", x, 7);
      add("chair", x + 1, 10);
    }
    add("chair", 11, 8);
    add("chair", 18, 8);
    for (const x of [4, 24]) for (const y of [5, 11]) workstation(x, y);
    for (const x of [4, 5, 24, 25]) add("bookshelf", x, 1);
    add("whiteboard", 16, 1);
    add("reception_desk", 6, 17);
    add("chair", 6, 18);
    meeting(23, 16);
    add("coffee", 20, 19);
    add("water_cooler", 21, 19);
    for (const x of [9, 20]) for (const y of [4, 12]) add("plant", x, y);
  } else {
    for (const start of [3, 21])
      for (const y of [2, 6, 10]) for (let x = start; x < start + 6; x++) add("bookshelf", x, y);
    for (const x of [12, 17]) for (const y of [4, 9, 14]) workstation(x, y);
    meeting(5, 16);
    meeting(23, 16);
    add("whiteboard", 13, 1);
    add("whiteboard", 17, 1);
    add("coffee", 10, 19);
    add("water_cooler", 19, 19);
  }
  for (const x of [1, 28]) for (const y of [1, 20]) add("plant", x, y);
  add("spawn", 15, 19);
  layer.objects = objects;
  return tagEnvironment(map, id);
}

function tagEnvironment(map: TiledMap, id: OfficeEnvironmentId): TiledMap {
  const layer = map.layers.find((entry) => entry.name === "Objects")!;
  layer.properties = [
    ...(layer.properties || []),
    { name: "officeEnvironment", type: "string", value: id },
    { name: "officeEnvironmentVersion", type: "int", value: 1 },
  ];
  return map;
}
