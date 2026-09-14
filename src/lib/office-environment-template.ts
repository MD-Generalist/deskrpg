import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "../game/three/office-environments";

import { sameJsonSnapshot } from "./same-json-snapshot";
import { effectiveMapSpawn } from "./effective-map-spawn";

/** Reuse only an exact built-in snapshot; user-edited templates remain untouched. */
export async function ensureOfficeEnvironmentTemplate(
  id: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const environment = OFFICE_ENVIRONMENTS.find((entry) => entry.id === id);
  if (!environment) throw new Error("Unknown office environment");
  const map = buildOfficeEnvironment(environment.id);
  const { col: spawnCol, row: spawnRow } = effectiveMapSpawn(map)!;
  const tag = `deskrpg-office-v${id === "agency" ? 3 : 2}:${id}`;
  const listResponse = await request("/api/map-templates");
  if (!listResponse.ok) throw new Error("Unable to load office environments");
  const list = await listResponse.json();
  for (const entry of Array.isArray(list.templates) ? list.templates : []) {
    if (entry.tags !== tag || typeof entry.id !== "string") continue;
    const response = await request(`/api/map-templates/${encodeURIComponent(entry.id)}`);
    if (!response.ok) continue;
    const { template } = await response.json();
    let tiledJson = template?.tiledJson;
    if (typeof tiledJson === "string") {
      try {
        tiledJson = JSON.parse(tiledJson);
      } catch {
        continue;
      }
    }
    if (
      template?.cols === map.width &&
      template?.rows === map.height &&
      template?.spawnCol === spawnCol &&
      template?.spawnRow === spawnRow &&
      sameJsonSnapshot(tiledJson, map)
    )
      return entry.id;
  }
  const response = await request("/api/map-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: environment.nameKo,
      description: environment.descriptionKo,
      cols: map.width,
      rows: map.height,
      spawnCol,
      spawnRow,
      tiledJson: map,
      tags: tag,
    }),
  });
  if (!response.ok) throw new Error("Unable to prepare office environment");
  const result = await response.json();
  if (typeof result.template?.id !== "string") throw new Error("Office environment ID is missing");
  return result.template.id;
}
