import type { AmbientZone } from "../ambient-zones";
import type { CreativeStudioAdd } from "./creative-studio-layout";

/** Reference-derived anchors, shared by navigation and the rendered architecture. */
export const TECH_STARTUP_SIZE = Object.freeze({ cols: 44, rows: 20 } as const);
export const TECH_STARTUP_BOUNDARIES = Object.freeze({
  server: Object.freeze({
    westCol: 0,
    eastCol: 6,
    backRow: 0,
    frontRow: 5,
    doorCols: [3, 4] as const,
  }),
  meeting: Object.freeze({
    westCol: 15,
    eastCol: 24,
    backRow: 0,
    frontRow: 7,
    doorCols: [22, 23] as const,
  }),
});
export const TECH_STARTUP_ENTRANCE = Object.freeze({
  fromCol: 21,
  toCol: 23,
  row: 19,
  spawnCol: 22,
  spawnRow: 17,
});
export const TECH_STARTUP_ZONES: readonly AmbientZone[] = Object.freeze([
  { id: "server", x: 1, y: 1, width: 5, height: 5, roaming: false },
  { id: "focus", x: 7, y: 1, width: 7, height: 5, roaming: false },
  { id: "meeting", x: 16, y: 1, width: 8, height: 6, roaming: false },
  { id: "hardware", x: 1, y: 6, width: 6, height: 7, roaming: true },
  { id: "work", x: 8, y: 8, width: 23, height: 6, roaming: true },
  { id: "collaboration", x: 26, y: 2, width: 7, height: 5, roaming: true },
  { id: "pantry", x: 34, y: 1, width: 9, height: 8, roaming: true },
  { id: "lounge", x: 33, y: 10, width: 10, height: 8, roaming: true },
]);

export function furnishTechStartup(add: CreativeStudioAdd): void {
  for (const room of Object.values(TECH_STARTUP_BOUNDARIES)) {
    for (let row = 1; row < room.frontRow; row++) {
      if (room.westCol > 0)
        add("glass_partition", room.westCol, row, { direction: "right", variant: "tech-frame" });
      add("glass_partition", room.eastCol, row, { direction: "right", variant: "tech-frame" });
    }
    for (let col = room.westCol + 1; col <= room.eastCol; col++) {
      if (!(room.doorCols as readonly number[]).includes(col))
        add("glass_partition", col, room.frontRow, { variant: "tech-frame" });
    }
  }
  for (const col of [2, 4])
    add("office_locker", col, 2, { variant: "tech-server-rack", destinationTags: ["server"] });
  for (const col of [8, 11])
    add("office_locker", col, 2, { variant: "tech-phone-booth", destinationTags: ["focus"] });
  add("plant", 7, 3, { variant: "ficus" });
  add("plant", 13, 2, { variant: "ficus" });

  // Six places in the transparent sprint room, with the doorway on its right.
  add("conference_table", 18, 3, { variant: "tech-meeting", destinationTags: ["meeting"] });
  for (const col of [18, 19, 21]) {
    add("chair", col, 2, { direction: "down", variant: "blue", destinationTags: ["meeting"] });
    add("chair", col, 5, { direction: "up", variant: "blue", destinationTags: ["meeting"] });
  }
  add("whiteboard", 20, 1, { variant: "tech-diagram" });
  add("plant", 16, 2, { variant: "ficus" });

  // Hardware repair bench along the left wall, outside the server enclosure.
  for (const row of [7, 8, 9, 10])
    add("desk", 2, row, {
      direction: "right",
      variant: "tech-hardware-bench",
      destinationTags: ["hardware"],
    });
  add("studio_stool", 3, 9, {
    direction: "left",
    variant: "graphite",
    destinationTags: ["hardware", "stool"],
  });
  add("office_locker", 4, 7, { variant: "tech-tool-cabinet" });

  // Four two-tile worktops face four more worktops in each desk island.
  for (const start of [9, 22]) {
    for (let i = 0; i < 4; i++) {
      const col = start + i * 2;
      for (const [row, chairRow, direction] of [
        [10, 9, "down"],
        [11, 12, "up"],
      ] as const) {
        add("reception_desk", col, row, {
          direction: direction === "down" ? "up" : "down",
          variant: "tech-workstation",
          destinationTags: ["work", "desk"],
        });
        add("computer", col, row, { direction, variant: "studio-monitor" });
        add("chair", col, chairRow, {
          direction,
          variant: "graphite",
          destinationTags: ["work", "desk"],
        });
      }
    }
  }

  add("low_cabinet", 26, 1, { variant: "tech-white" });
  add("office_printer", 28, 1, { variant: "tech-white" });
  add("plant", 30, 1, { variant: "ficus" });
  add("studio_counter", 27, 3, { variant: "tech-standing", destinationTags: ["collaboration"] });
  for (const col of [27, 28, 30])
    add("studio_stool", col, 4, {
      direction: "up",
      variant: "blue",
      destinationTags: ["collaboration", "stool"],
    });
  add("mobile_board", 32, 3, { variant: "tech-sprint" });

  add("refrigerator", 35, 2, { variant: "tech-steel" });
  add("kitchen_counter", 37, 2, { variant: "tech-sink", destinationTags: ["pantry"] });
  add("kitchen_counter", 39, 2, { variant: "tech-coffee", destinationTags: ["pantry"] });
  add("coffee", 41, 2, { variant: "tech-coffee" });
  add("studio_counter", 36, 5, { variant: "tech-island", destinationTags: ["pantry"] });
  add("desk", 40, 5, { variant: "tech-island-extension", destinationTags: ["pantry"] });
  for (const col of [36, 37, 38, 39, 40])
    add("studio_stool", col, 6, {
      direction: "up",
      variant: "mint",
      destinationTags: ["pantry", "stool"],
    });
  add("plant", 42, 3, { variant: "ficus" });

  // Modular right-angle sofa: shared three-seat modules preserve real seat anchors.
  add("studio_sofa", 37, 11, {
    direction: "down",
    variant: "blue",
    destinationTags: ["lounge", "sofa"],
  });
  add("studio_sofa", 40, 12, {
    direction: "left",
    variant: "blue",
    destinationTags: ["lounge", "sofa"],
  });
  add("meeting_table", 37, 14, { variant: "tech-coffee", destinationTags: ["lounge"] });
  add("office_armchair", 34, 12, {
    direction: "right",
    variant: "tech-beanbag",
    destinationTags: ["lounge"],
  });
  add("office_armchair", 34, 16, {
    direction: "right",
    variant: "tech-beanbag",
    destinationTags: ["lounge"],
  });
  add("studio_stool", 37, 17, { variant: "tech-white", destinationTags: ["lounge", "stool"] });
  add("studio_shelf", 41, 13, { direction: "right", variant: "tech-library" });
  for (const [col, row, variant] of [
    [1, 12, "ficus"],
    [7, 17, "ficus"],
    [31, 17, "ficus"],
    [42, 10, "ficus"],
    [42, 17, "ficus"],
  ] as const)
    add("plant", col, row, { variant });
}
