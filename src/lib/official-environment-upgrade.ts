import publishingV3Initial from "./fixtures/official-publishing-v3-initial.json";
import agencyV2 from "./fixtures/official-agency-v2.json";
import agencyV3 from "./fixtures/official-agency-v3.json";
import agencyV4 from "./fixtures/official-agency-v4.json";
import tradingV2 from "./fixtures/official-trading-v2.json";
import publishingV2 from "./fixtures/official-publishing-v2.json";
import techV2 from "./fixtures/official-tech-v2.json";
import { buildOfficeEnvironment } from "../game/three/office-environments";
import { parseDbJson } from "./db-json";
import { sameJsonSnapshot } from "./same-json-snapshot";

/** The entire historical snapshot is evidence; labels/version alone grant nothing. */
export function upgradeOfficialEnvironmentMap(map: unknown): {
  map: unknown;
  upgraded: boolean;
  fromVersion?: number;
} {
  const parsed = parseDbJson(map);
  if (sameJsonSnapshot(parsed, publishingV3Initial)) {
    return { map: buildOfficeEnvironment("publishing"), upgraded: true, fromVersion: 3 };
  }
  if (sameJsonSnapshot(parsed, publishingV2)) {
    return { map: buildOfficeEnvironment("publishing"), upgraded: true, fromVersion: 2 };
  }
  if (sameJsonSnapshot(parsed, tradingV2)) {
    return { map: buildOfficeEnvironment("trading"), upgraded: true, fromVersion: 2 };
  }
  if (sameJsonSnapshot(parsed, techV2)) {
    return { map: buildOfficeEnvironment("tech"), upgraded: true, fromVersion: 2 };
  }
  const fromVersion = sameJsonSnapshot(parsed, agencyV2)
    ? 2
    : sameJsonSnapshot(parsed, agencyV3)
      ? 3
      : sameJsonSnapshot(parsed, agencyV4)
        ? 4
        : undefined;
  if (!fromVersion) return { map, upgraded: false };
  return { map: buildOfficeEnvironment("agency"), upgraded: true, fromVersion };
}
