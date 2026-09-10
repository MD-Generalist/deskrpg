import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "../game/three/office-environments";

/** JSONB may reorder object keys; array position remains part of the snapshot contract. */
function sameJsonSnapshot(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonSnapshot(value, right[index]))
    );
  }
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject);
  return (
    keys.length === Object.keys(rightObject).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightObject, key) &&
        sameJsonSnapshot(leftObject[key], rightObject[key]),
    )
  );
}

/** Reuse only an exact built-in snapshot; user-edited templates remain untouched. */
export async function ensureOfficeEnvironmentTemplate(
  id: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const environment = OFFICE_ENVIRONMENTS.find((entry) => entry.id === id);
  if (!environment) throw new Error("Unknown office environment");
  const map = buildOfficeEnvironment(environment.id);
  const tag = `deskrpg-office-v1:${id}`;
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
      template?.spawnCol === 15 &&
      template?.spawnRow === 19 &&
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
      spawnCol: 15,
      spawnRow: 19,
      tiledJson: map,
      tags: tag,
    }),
  });
  if (!response.ok) throw new Error("Unable to prepare office environment");
  const result = await response.json();
  if (typeof result.template?.id !== "string") throw new Error("Office environment ID is missing");
  return result.template.id;
}
