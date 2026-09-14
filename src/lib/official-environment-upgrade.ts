import agencyV2 from "./fixtures/official-agency-v2.json";
import { buildOfficeEnvironment } from "../game/three/office-environments";
import { parseDbJson } from "./db-json";
import { sameJsonSnapshot } from "./same-json-snapshot";

/** The entire historical snapshot is evidence; labels/version alone grant nothing. */
export function upgradeOfficialEnvironmentMap(map: unknown): {
  map: unknown;
  upgraded: boolean;
  fromVersion?: number;
} {
  if (!sameJsonSnapshot(parseDbJson(map), agencyV2)) return { map, upgraded: false };
  return { map: buildOfficeEnvironment("agency"), upgraded: true, fromVersion: 2 };
}
