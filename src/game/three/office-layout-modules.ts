import type { CreativeStudioAdd } from "./creative-studio-layout";

export interface OfficeRoomBoundary {
  id: string;
  westCol: number;
  eastCol: number;
  backRow: number;
  frontRow: number;
  doorSide: "left" | "right" | "front";
  doorCells: readonly number[];
  roaming: boolean;
}

/** One shared grid boundary per room; doorway cells remain traversable. */
export function furnishRoomBoundary(
  add: CreativeStudioAdd,
  room: OfficeRoomBoundary,
  variant: string,
  perimeter: { westCol: number; eastCol: number; backRow: number },
) {
  for (let row = room.backRow; row <= room.frontRow; row++) {
    if (row === perimeter.backRow) continue;
    for (const [side, col] of [
      ["left", room.westCol],
      ["right", room.eastCol],
    ] as const) {
      if (
        col === perimeter.westCol ||
        col === perimeter.eastCol ||
        (room.doorSide === side && room.doorCells.includes(row))
      )
        continue;
      add("glass_partition", col, row, { direction: "right", variant });
    }
  }
  for (const row of [room.backRow, room.frontRow]) {
    if (row === perimeter.backRow) continue;
    for (let col = room.westCol + 1; col < room.eastCol; col++) {
      if (row === room.frontRow && room.doorSide === "front" && room.doorCells.includes(col))
        continue;
      add("glass_partition", col, row, { variant });
    }
  }
}

/** Two opposed pairs; the divider seam and chairs share the same anchors. */
export function furnishDeskIsland(
  add: CreativeStudioAdd,
  col: number,
  row: number,
  variant = "tech-workstation",
) {
  for (const x of [col, col + 2]) {
    for (const [z, chairRow, direction] of [
      [row, row - 1, "down"],
      [row + 1, row + 2, "up"],
    ] as const) {
      add("reception_desk", x, z, {
        variant,
        direction: direction === "down" ? "up" : "down",
        destinationTags: ["work", "desk"],
      });
      add("computer", x, z, { variant: "studio-monitor", direction });
      add("chair", x, chairRow, {
        variant: "navy-office",
        direction,
        destinationTags: ["work", "desk"],
      });
    }
  }
}

export function furnishLounge(add: CreativeStudioAdd, col: number, row: number, tag: string) {
  add("studio_sofa", col + 1, row, {
    variant: "navy",
    direction: "down",
    destinationTags: [tag, "sofa"],
  });
  add("meeting_table", col + 1, row + 2, { variant: "trade-coffee-table" });
  add("office_armchair", col - 1, row + 2, {
    variant: "navy",
    direction: "right",
    destinationTags: [tag],
  });
  add("office_armchair", col + 4, row + 2, {
    variant: "navy",
    direction: "left",
    destinationTags: [tag],
  });
}

/** A single footprint mask drives both rendered flooring and navigation. */
export function officeFootprintLayers(
  cols: number,
  rows: number,
  includes: (col: number, row: number) => boolean,
) {
  const floor = Array.from({ length: cols * rows }, (_, i) =>
    includes(i % cols, Math.floor(i / cols)) ? 1 : 0,
  );
  return { floor, collision: floor.map((value) => (value ? 0 : 1)) };
}
