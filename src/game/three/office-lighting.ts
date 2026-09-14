import type { OfficeEnvironmentId } from "./office-environments";
export function officeLighting(environment?: OfficeEnvironmentId) {
  return {
    sun: environment === "publishing" || environment === "executive" ? "#ffe7c5" : "#fff3df",
    sky: environment === "tech" ? "#e6f3ff" : "#edf3ff",
    sunIntensity: environment === "executive" ? 2.5 : 2.8,
    fillIntensity: 0.7,
    hemisphereIntensity: 1.45,
    exposure: environment === "executive" ? 1.12 : 1.05,
  };
}
/** Fit the whole translated map, including furniture height, into the shadow frustum. */
export function shadowExtent(cols: number, rows: number) {
  return Math.hypot(cols, rows) / 2 + 4;
}
