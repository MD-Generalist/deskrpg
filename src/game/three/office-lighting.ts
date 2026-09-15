import { Mesh, PCFShadowMap, PCFSoftShadowMap, type Object3D, type ShadowMapType } from "three";
import type { OfficeEnvironmentId } from "./office-environments";
export function officeLighting(environment?: OfficeEnvironmentId, environmentVersion?: number) {
  const studio = environment === "agency" && (environmentVersion ?? 0) >= 3;
  return {
    // Three's PCFSoft branch ignores radius; studio uses its supported 17-tap PCF
    // kernel with wider texel offsets. Legacy environments retain their exact filter.
    shadowMapType: studio ? PCFShadowMap : PCFSoftShadowMap,
    shadowRadius: studio ? 3 : 1,
    sun: studio
      ? "#ffe7ce"
      : environment === "publishing" || environment === "executive"
        ? "#ffe7c5"
        : "#fff3df",
    sky: environment === "tech" ? "#e6f3ff" : "#edf3ff",
    sunIntensity: studio ? 2.35 : environment === "executive" ? 2.5 : 2.8,
    fillIntensity: studio ? 0.85 : 0.7,
    hemisphereIntensity: studio ? 1.5 : 1.45,
    exposure: studio ? 1.08 : environment === "executive" ? 1.12 : 1.05,
  };
}
/** Fit the whole translated map, including furniture height, into the shadow frustum. */
export function shadowExtent(cols: number, rows: number) {
  return Math.hypot(cols, rows) / 2 + 4;
}

/** Existing actor materials survive map changes and must recompile the shadow define. */
export function applyOfficeShadowFilter(
  scene: Object3D,
  shadowMap: { type: ShadowMapType },
  type: ShadowMapType,
) {
  if (shadowMap.type === type) return;
  shadowMap.type = type;
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      material.needsUpdate = true;
  });
}
