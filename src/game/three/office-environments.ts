import { furnishOfficeRooms, OFFICE_ROOMS } from "./office-room-layout";
import {
  CREATIVE_STUDIO_SIZE,
  CREATIVE_STUDIO_ZONES,
  furnishCreativeStudio,
  type CreativeStudioPlacement,
} from "./creative-studio-layout";
import {
  createDefaultMap,
  type TiledMap,
  type TiledObject,
  type TiledProperty,
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
    nameKo: "크리에이티브 스튜디오",
    nameEn: "Creative studio",
    descriptionKo: "촬영, 아이데이션, 프로덕션과 라운지가 이어지는 열린 스튜디오",
    descriptionEn: "An open studio linking photo, ideation, production and lounge zones.",
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
    descriptionKo: "월넛 업무석, 라운드 미팅과 응접 라운지가 있는 임원실",
    descriptionEn:
      "A walnut executive suite with a round meeting table and a warm reception lounge.",
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

export const CREATIVE_STUDIO_ENTRANCE = Object.freeze({
  fromCol: 21,
  toCol: 25,
  row: 25,
  spawnCol: 23,
  spawnRow: 23,
} as const);

/** Fresh, deterministic standard Tiled maps. Calling this never edits an existing project. */
export function buildOfficeEnvironment(id: OfficeEnvironmentId): TiledMap {
  const environment = OFFICE_ENVIRONMENTS.find((entry) => entry.id === id);
  if (!environment) throw new Error(`Unknown office environment: ${id}`);
  const cols = id === "agency" ? CREATIVE_STUDIO_SIZE.cols : id === "executive" ? 18 : 30;
  const rows = id === "agency" ? CREATIVE_STUDIO_SIZE.rows : id === "executive" ? 18 : 22;
  const entrance = id === "agency" ? CREATIVE_STUDIO_ENTRANCE.spawnCol : Math.floor(cols / 2);
  const map = createDefaultMap(environment.nameEn, cols, rows, 32);
  const layer = map.layers.find((entry) => entry.name === "Objects")!;
  const objects: TiledObject[] = [];
  const add = (type: string, col: number, row: number, placement: CreativeStudioPlacement = {}) => {
    const size = getObjectDimensions(type, placement.direction);
    const properties: TiledProperty[] = [];
    if (placement.direction)
      properties.push({ name: "direction", type: "string", value: placement.direction });
    if (placement.variant)
      properties.push({ name: "variant", type: "string", value: placement.variant });
    if (placement.destinationTags)
      properties.push({
        name: "destinationTags",
        type: "string",
        value: JSON.stringify(placement.destinationTags),
      });
    objects.push({
      id: map.nextobjectid++,
      name: type,
      type,
      x: col * 32,
      y: row * 32,
      width: size.width * 32,
      height: size.height * 32,
      visible: true,
      ...(properties.length ? { properties } : {}),
    });
  };
  for (let x = 0; x < cols; x++) {
    add("cubicle_wall", x, 0);
    const atEntrance =
      id === "agency"
        ? x >= CREATIVE_STUDIO_ENTRANCE.fromCol && x <= CREATIVE_STUDIO_ENTRANCE.toCol
        : Math.abs(x - entrance) <= 1;
    if (!atEntrance) add("cubicle_wall", x, rows - 1);
  }
  for (let y = 1; y < rows - 1; y++) {
    add("cubicle_wall", 0, y);
    add("cubicle_wall", cols - 1, y);
  }
  if (id === "agency") furnishCreativeStudio(add);
  else furnishOfficeRooms(id, (type, x, y, direction) => add(type, x, y, { direction }));
  if (id !== "agency")
    for (const x of [1, cols - 2])
      for (const y of [1, rows - 2]) {
        if (!objects.some((object) => object.x === x * 32 && object.y === y * 32))
          add("plant", x, y);
      }
  if (id === "executive") {
    for (const object of objects) {
      if (["office_sofa", "office_armchair"].includes(object.type)) {
        object.properties = [
          ...(object.properties || []),
          { name: "variant", type: "string", value: "executive-lounge" },
        ];
      }
    }
  }
  add("spawn", entrance, id === "agency" ? CREATIVE_STUDIO_ENTRANCE.spawnRow : rows - 3);
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
          id === "agency"
            ? CREATIVE_STUDIO_ZONES
            : OFFICE_ROOMS[id].map((room) => ({
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
    {
      name: "officeEnvironmentVersion",
      type: "int",
      value: id === "agency" ? 3 : id === "executive" ? 5 : 2,
    },
  ];
  return map;
}
