import type { CreativeStudioAdd } from "./creative-studio-layout";
import {
  furnishDeskIsland,
  furnishLounge,
  furnishRoomBoundary,
  type OfficeRoomBoundary,
} from "./office-layout-modules";

export const TRADING_SIZE = Object.freeze({ cols: 44, rows: 30 });
export const TRADING_VOID = Object.freeze({ x: 18, y: 19, width: 8, height: 11 });
export const TRADING_ENTRANCE = Object.freeze({
  fromCol: 36,
  toCol: 38,
  row: 29,
  spawnCol: 37,
  spawnRow: 27,
});
export const TRADING_ROOMS: readonly OfficeRoomBoundary[] = [
  {
    id: "conference",
    westCol: 0,
    eastCol: 9,
    backRow: 0,
    frontRow: 10,
    doorSide: "right",
    doorCells: [7, 8],
    roaming: true,
  },
  {
    id: "director",
    westCol: 0,
    eastCol: 8,
    backRow: 10,
    frontRow: 17,
    doorSide: "right",
    doorCells: [14, 15],
    roaming: false,
  },
  {
    id: "manager",
    westCol: 0,
    eastCol: 8,
    backRow: 17,
    frontRow: 24,
    doorSide: "right",
    doorCells: [21, 22],
    roaming: false,
  },
  {
    id: "square-meeting",
    westCol: 35,
    eastCol: 43,
    backRow: 0,
    frontRow: 8,
    doorSide: "left",
    doorCells: [5, 6],
    roaming: true,
  },
  {
    id: "round-meeting",
    westCol: 35,
    eastCol: 43,
    backRow: 8,
    frontRow: 15,
    doorSide: "left",
    doorCells: [12, 13],
    roaming: true,
  },
  {
    id: "sales-office",
    westCol: 36,
    eastCol: 43,
    backRow: 15,
    frontRow: 20,
    doorSide: "left",
    doorCells: [18, 19],
    roaming: false,
  },
  {
    id: "showroom",
    westCol: 36,
    eastCol: 43,
    backRow: 20,
    frontRow: 24,
    doorSide: "left",
    doorCells: [23, 24],
    roaming: true,
  },
];
export const TRADING_ZONES = [
  ...TRADING_ROOMS.map((r) => ({
    id: r.id,
    x: r.westCol + 1,
    y: r.backRow + 1,
    width: r.eastCol - r.westCol - 1,
    height: r.frontRow - r.backRow - 1,
    roaming: r.roaming,
  })),
  { id: "work", x: 10, y: 5, width: 24, height: 12, roaming: true },
  { id: "entry-lounge", x: 34, y: 26, width: 9, height: 3, roaming: true },
];
export function tradingFloorCell(col: number, row: number) {
  return !(
    col >= TRADING_VOID.x &&
    col < TRADING_VOID.x + TRADING_VOID.width &&
    row >= TRADING_VOID.y
  );
}
export function furnishTrading(add: CreativeStudioAdd) {
  // Shared room edges are emitted once, even where two rooms meet.
  const emitted = new Set<string>();
  const boundaryAdd: CreativeStudioAdd = (type, x, y, p) => {
    const key = `${x},${y}`;
    if (!emitted.has(key)) {
      emitted.add(key);
      add(type, x, y, p);
    }
  };
  for (const room of TRADING_ROOMS)
    furnishRoomBoundary(boundaryAdd, room, "trading-frame", {
      westCol: 0,
      eastCol: TRADING_SIZE.cols - 1,
      backRow: 0,
    });
  for (const [x, y] of [
    [11, 7],
    [29, 7],
    [18, 10],
    [24, 10],
    [11, 14],
    [29, 14],
  ])
    furnishDeskIsland(add, x, y);
  for (const [x, y] of [
    [10, 7],
    [15, 7],
    [28, 7],
    [33, 7],
    [17, 10],
    [22, 10],
    [23, 10],
    [28, 10],
    [10, 14],
    [15, 14],
    [28, 14],
    [33, 14],
  ])
    add("plant", x, y, { variant: "ficus" });
  // Twelve-person boardroom: two end-to-end shared conference tables.
  add("conference_table", 2, 3, { variant: "trading-boardroom" });
  add("conference_table", 2, 5, { variant: "trading-boardroom" });
  for (const row of [3, 4, 5, 6]) {
    add("chair", 1, row, {
      direction: "right",
      variant: "navy-office",
      destinationTags: ["conference"],
    });
    add("chair", 6, row, {
      direction: "left",
      variant: "navy-office",
      destinationTags: ["conference"],
    });
  }
  for (const col of [3, 4]) {
    add("chair", col, 2, {
      direction: "down",
      variant: "navy-office",
      destinationTags: ["conference"],
    });
    add("chair", col, 7, {
      direction: "up",
      variant: "navy-office",
      destinationTags: ["conference"],
    });
  }
  add("whiteboard", 3, 1, { variant: "trading-screen" });
  for (const [x, y, tag] of [
    [3, 13, "director"],
    [3, 20, "manager"],
    [39, 17, "sales-office"],
  ] as const) {
    add("reception_desk", x, y, { variant: "tech-workstation", direction: "down" });
    add("computer", x, y, { variant: "studio-monitor" });
    add("chair", x, y + 1, { direction: "up", variant: "navy-office", destinationTags: [tag] });
    add("low_cabinet", x - 1, tag === "sales-office" ? y - 1 : y - 2, { variant: "trading-files" });
  }
  for (const [y, tag] of [
    [3, "square-meeting"],
    [10, "round-meeting"],
  ] as const) {
    add("meeting_table", 38, y, {
      variant: tag === "square-meeting" ? "trade-square-table" : "trade-round-table",
    });
    for (const [x, z, d] of [
      [38, y - 1, "down"],
      [39, y + 2, "up"],
      [37, y, "right"],
      [40, y + 1, "left"],
    ] as const)
      add("chair", x, z, { direction: d, variant: "navy-office", destinationTags: [tag] });
  }
  for (const x of [11, 14, 28, 31])
    add("reception_desk", x, 2, {
      variant: x < 20 ? "trade-display-cabinet" : "trade-air-display",
    });
  add("whiteboard", 21, 1, { variant: "trading-world-map" });
  add("office_printer", 20, 4);
  add("studio_counter", 22, 4, { variant: "trade-packing-bench" });
  add("studio_shelf", 37, 21, { variant: "trade-sample-display" });
  add("meeting_table", 40, 21, { variant: "trading-sample-table" });
  add("reception_desk", 30, 25, { variant: "trading-reception" });
  add("chair", 30, 24, {
    direction: "down",
    variant: "navy-office",
    destinationTags: ["reception"],
  });
  furnishLounge(add, 37, 25, "entry-lounge");
  add("office_armchair", 2, 26, {
    direction: "right",
    variant: "navy",
    destinationTags: ["lounge"],
  });
  add("office_armchair", 7, 26, {
    direction: "left",
    variant: "navy",
    destinationTags: ["lounge"],
  });
  add("meeting_table", 4, 26, { variant: "trade-coffee-table" });
  for (const [x, y] of [
    [9, 18],
    [9, 22],
    [33, 19],
    [33, 22],
  ])
    add("low_cabinet", x, y, { variant: "trading-files" });
  for (const [x, y] of [
    [1, 1],
    [7, 12],
    [7, 19],
    [1, 27],
    [10, 26],
    [17, 18],
    [26, 18],
    [34, 26],
    [34, 27],
    [42, 9],
    [34, 2],
    [17, 2],
    [26, 2],
  ])
    add("plant", x, y, { variant: "ficus" });
}
