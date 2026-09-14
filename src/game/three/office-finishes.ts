import type { OfficeEnvironmentId } from "./office-environments";
export const OFFICE_FINISHES = {
  trading: {
    upholstery: "#596778",
    mat: "#384c57",
    accent: "#a58653",
    floor: "wood",
    prop: "binder",
  },
  agency: {
    upholstery: "#986953",
    mat: "#697d68",
    accent: "#c88364",
    floor: "wood",
    prop: "swatches",
  },
  tech: {
    upholstery: "#486976",
    mat: "#334955",
    accent: "#6ab1a4",
    floor: "fabric",
    prop: "device",
  },
  executive: {
    upholstery: "#504c48",
    mat: "#3d443d",
    accent: "#b89b64",
    floor: "wood",
    prop: "folio",
  },
  publishing: {
    upholstery: "#52666a",
    mat: "#405553",
    accent: "#a17b4f",
    floor: "wood",
    prop: "manuscript",
  },
} as const;
export function officeFinish(id?: OfficeEnvironmentId) {
  return OFFICE_FINISHES[id ?? "publishing"];
}

/** V3 styling is opt-in so edited v2 agency maps keep their saved visual identity. */
export const CREATIVE_STUDIO_FINISH = {
  upholstery: "#e7dfd1",
  mat: "#b3aa96",
  accent: "#c87b65",
  floor: "wood",
  prop: "swatches",
} as const;
