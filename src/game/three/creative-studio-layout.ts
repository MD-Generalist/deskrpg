import type { AmbientArea, AmbientZone } from "../ambient-zones";
import type { MapObject } from "../../lib/object-types";

export const CREATIVE_STUDIO_SIZE = Object.freeze({ cols: 42, rows: 26 } as const);

const area = (x: number, y: number, width: number, height: number): AmbientArea => ({
  x,
  y,
  width,
  height,
});

export type StudioZone = AmbientZone & {
  access: "ambient" | "purpose-only";
  destinationTags: readonly string[];
};

export const CREATIVE_STUDIO_ZONES: readonly StudioZone[] = Object.freeze([
  Object.freeze({
    id: "photo",
    x: 1,
    y: 2,
    width: 9,
    height: 9,
    roaming: false,
    access: "purpose-only" as const,
    destinationTags: Object.freeze(["photo"]),
  }),
  Object.freeze({
    id: "workstations",
    x: 11,
    y: 2,
    width: 13,
    height: 7,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["work", "desk"]),
    destinationExclusions: Object.freeze([area(11, 2, 1, 7), area(11, 8, 13, 1)]),
  }),
  Object.freeze({
    id: "ideation",
    x: 10,
    y: 9,
    width: 10,
    height: 8,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["ideation", "collaboration"]),
    destinationExclusions: Object.freeze([area(10, 9, 2, 8), area(10, 15, 10, 2)]),
  }),
  Object.freeze({
    id: "main-lounge",
    x: 22,
    y: 7,
    width: 10,
    height: 8,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["lounge", "sofa"]),
    destinationExclusions: Object.freeze([area(30, 7, 2, 8)]),
  }),
  Object.freeze({
    id: "production",
    x: 16,
    y: 16,
    width: 14,
    height: 8,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["production", "worktable"]),
    destinationExclusions: Object.freeze([area(16, 16, 14, 1), area(16, 23, 14, 1)]),
  }),
  Object.freeze({
    id: "meeting",
    x: 32,
    y: 2,
    width: 10,
    height: 9,
    roaming: false,
    access: "purpose-only" as const,
    destinationTags: Object.freeze(["meeting"]),
  }),
  Object.freeze({
    id: "pantry",
    x: 32,
    y: 11,
    width: 10,
    height: 8,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["pantry", "stool"]),
  }),
  Object.freeze({
    id: "small-lounge",
    x: 32,
    y: 19,
    width: 10,
    height: 7,
    roaming: true,
    access: "ambient" as const,
    destinationTags: Object.freeze(["lounge", "sofa"]),
  }),
]);

export type CreativeStudioPlacement = Pick<MapObject, "direction" | "variant" | "destinationTags">;
export type CreativeStudioAdd = (
  type: string,
  col: number,
  row: number,
  placement?: CreativeStudioPlacement,
) => void;

/** Tile anchors ship now; Task 4 must add catalog-local anchors without moving this navigation grid. */
export const CREATIVE_STUDIO_SEAT_CONTRACT = Object.freeze({
  tileGridAnchors: 34,
  deferredCatalogSeatsPerObject: Object.freeze({ studio_sofa: 3, studio_stool: 1 }),
  deferredCatalogAnchors: 9,
  totalAnchors: 43,
} as const);

export function furnishCreativeStudio(add: CreativeStudioAdd) {
  // Photo bay: tall boundary stops short of the two-tile cross aisle at rows 8-9.
  add("photo_cyclorama", 2, 2, { variant: "coral", destinationTags: ["photo"] });
  add("photo_light", 2, 6, { direction: "right", variant: "softbox", destinationTags: ["photo"] });
  add("photo_light", 8, 6, { direction: "left", variant: "softbox", destinationTags: ["photo"] });
  add("photo_camera", 5, 7, { direction: "up", variant: "tripod", destinationTags: ["photo"] });
  add("studio_shelf", 1, 5, {
    direction: "right",
    variant: "equipment",
    destinationTags: ["photo"],
  });
  add("studio_shelf", 5, 5, {
    variant: "prop-storage",
    destinationTags: ["photo"],
  });
  add("photo_light", 7, 7, {
    direction: "left",
    variant: "reflector",
    destinationTags: ["photo"],
  });
  for (const row of [5, 6, 7])
    add("glass_partition", 9, row, { direction: "right", variant: "black-frame" });

  // Rear-left four-person workstation island and storage.
  for (const [col, row] of [
    [13, 3],
    [14, 3],
    [13, 4],
    [14, 4],
  ] as const) {
    add("desk", col, row, { variant: "studio-oak", destinationTags: ["work", "desk"] });
    add("computer", col, row, { variant: "studio-monitor" });
  }
  for (const [col, row, direction] of [
    [13, 2, "down"],
    [14, 2, "down"],
    [13, 5, "up"],
    [14, 5, "up"],
  ] as const)
    add("chair", col, row, {
      direction,
      variant: "office-neutral",
      destinationTags: ["work", "desk"],
    });
  add("studio_shelf", 19, 2, { variant: "credenza" });
  // 두 번째 4인 업무석 군집을 배치해 소규모 팀이 함께 작업할 수 있게 한다.
  for (const [col, row] of [
    [17, 3],
    [18, 3],
    [17, 4],
    [18, 4],
  ] as const) {
    add("desk", col, row, { variant: "studio-oak", destinationTags: ["work", "desk"] });
    add("computer", col, row, { variant: "studio-monitor" });
  }
  for (const [col, row, direction] of [
    [17, 2, "down"],
    [18, 2, "down"],
    [17, 5, "up"],
    [18, 5, "up"],
  ] as const)
    add("chair", col, row, {
      direction,
      variant: "office-color",
      destinationTags: ["work", "desk"],
    });
  add("studio_shelf", 20, 6, {
    variant: "materials",
    destinationTags: ["work", "desk"],
  });
  add("plant", 22, 2, { variant: "ficus" });

  // Ideation table. Eight tile-grid chairs are the Task 2 navigation fallback.
  add("studio_round_table", 13, 11, {
    variant: "idea-table",
    destinationTags: ["ideation", "collaboration"],
  });
  for (const [col, row, direction, variant] of [
    [13, 10, "down", "coral"],
    [14, 10, "down", "teal"],
    [15, 10, "down", "mustard"],
    [12, 11, "right", "neutral"],
    [16, 11, "left", "coral"],
    [12, 13, "right", "teal"],
    [16, 13, "left", "mustard"],
    [14, 14, "up", "neutral"],
  ] as const)
    add("chair", col, row, { direction, variant, destinationTags: ["ideation", "collaboration"] });
  add("mobile_board", 17, 10, { direction: "right", variant: "idea-board" });

  // Main social lounge stays west of the two-tile east circulation spine.
  add("studio_sofa", 24, 7, {
    direction: "down",
    variant: "curved-off-white",
    destinationTags: ["lounge", "sofa"],
  });
  add("meeting_table", 25, 11, { variant: "round-low", destinationTags: ["lounge"] });
  add("office_armchair", 23, 11, { direction: "right", variant: "teal" });
  add("office_armchair", 28, 11, { direction: "left", variant: "coral" });
  add("plant", 29, 7, { variant: "olive" });
  add("studio_shelf", 22, 14, { variant: "low-divider", destinationTags: ["lounge"] });
  add("plant", 29, 14, { variant: "monstera" });

  // Dressed production table with eight independently reachable legacy chairs.
  add("studio_worktable", 20, 18, {
    variant: "dressed",
    destinationTags: ["production", "worktable"],
  });
  for (const [col, row, direction] of [
    [20, 17, "down"],
    [22, 17, "down"],
    [23, 17, "down"],
    [25, 17, "down"],
    [20, 21, "up"],
    [22, 21, "up"],
    [23, 21, "up"],
    [25, 21, "up"],
  ] as const)
    add("chair", col, row, {
      direction,
      variant: "side-neutral",
      destinationTags: ["production", "worktable"],
    });
  add("studio_shelf", 16, 21, { variant: "sample-rack", destinationTags: ["production"] });
  add("studio_shelf", 27, 18, {
    direction: "right",
    variant: "material-library",
    destinationTags: ["production"],
  });
  add("studio_shelf", 27, 21, { variant: "print-rack", destinationTags: ["production"] });

  // Glass meeting enclosure. The opening at rows 8-9 connects to the east spine.
  for (const row of [2, 3, 4, 5, 6, 7, 10])
    add("glass_partition", 32, row, { direction: "right", variant: "black-frame" });
  add("conference_table", 35, 4, { variant: "studio-oak", destinationTags: ["meeting"] });
  for (const [col, row, direction] of [
    [35, 3, "down"],
    [38, 3, "down"],
    [35, 6, "up"],
    [38, 6, "up"],
    [34, 4, "right"],
    [39, 4, "left"],
  ] as const)
    add("chair", col, row, { direction, variant: "meeting-neutral", destinationTags: ["meeting"] });
  add("meeting_display", 36, 2, { variant: "wall-display" });
  add("mobile_board", 39, 8, { direction: "right", variant: "meeting-board" });

  // Pantry and bar.
  add("studio_shelf", 33, 11, { variant: "pantry-storage" });
  add("studio_counter", 37, 11, { variant: "coral-backed", destinationTags: ["pantry"] });
  for (const col of [37, 38, 39])
    add("studio_stool", col, 12, {
      direction: "up",
      variant: "oak",
      destinationTags: ["pantry", "stool"],
    });
  add("kitchen_counter", 33, 14, { variant: "sink", destinationTags: ["pantry"] });
  add("microwave_cabinet", 35, 14, {
    variant: "coffee-station",
    destinationTags: ["pantry"],
  });
  add("refrigerator", 40, 14, { variant: "under-counter", destinationTags: ["pantry"] });
  add("plant", 40, 17, { variant: "ficus" });

  // Informal front-right lounge and reference storage.
  add("studio_shelf", 39, 19, { variant: "reference" });
  add("studio_sofa", 35, 20, {
    direction: "down",
    variant: "teal",
    destinationTags: ["lounge", "sofa"],
  });
  add("meeting_table", 35, 22, { variant: "round-low", destinationTags: ["lounge"] });
  add("office_armchair", 33, 22, { direction: "right", variant: "mustard" });
  add("office_armchair", 38, 22, {
    direction: "left",
    variant: "coral",
    destinationTags: ["lounge", "sofa"],
  });
  add("plant", 32, 24, { variant: "monstera" });
  add("plant", 40, 24, { variant: "olive" });
}
