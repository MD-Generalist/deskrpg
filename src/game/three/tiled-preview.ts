import type { TiledMap } from "../../lib/tiled-map";
import { projectTiledGeometry } from "../../lib/tiled-geometry";
import type { MapSnapshot } from "./bridge";
import {
  resolveOfficeEnvironment,
  resolveOfficeEnvironmentVersion,
} from "./office-environment-theme";

/** UI-only metadata stays outside the shared server geometry dependency graph. */
export function tiledSnapshot(map: TiledMap): MapSnapshot {
  return {
    ...projectTiledGeometry(map),
    environment: resolveOfficeEnvironment(map),
    environmentVersion: resolveOfficeEnvironmentVersion(map),
  };
}
