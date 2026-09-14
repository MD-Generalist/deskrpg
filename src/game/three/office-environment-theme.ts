import type { OfficeEnvironmentId } from "./office-environments";

export function isOfficeEnvironmentId(value: unknown): value is OfficeEnvironmentId {
  return (
    value === "trading" ||
    value === "agency" ||
    value === "tech" ||
    value === "executive" ||
    value === "publishing"
  );
}

/** Read only the explicit Objects-layer tag; malformed or legacy maps keep their theme. */
export function resolveOfficeEnvironment(mapOrLayers: unknown): OfficeEnvironmentId | undefined {
  const layers = Array.isArray(mapOrLayers) ? mapOrLayers : record(mapOrLayers)?.layers;
  if (!Array.isArray(layers)) return undefined;
  for (const candidate of layers) {
    const layer = record(candidate);
    if (
      layer?.type !== "objectgroup" ||
      typeof layer.name !== "string" ||
      layer.name.toLowerCase() !== "objects" ||
      !Array.isArray(layer.properties)
    )
      continue;
    for (const candidateProperty of layer.properties) {
      const property = record(candidateProperty);
      if (
        property?.name === "officeEnvironment" &&
        property.type === "string" &&
        isOfficeEnvironmentId(property.value)
      )
        return property.value;
    }
  }
  return undefined;
}

/** Read a positive integer template version without assuming one for old or custom maps. */
export function resolveOfficeEnvironmentVersion(mapOrLayers: unknown): number | undefined {
  const layers = Array.isArray(mapOrLayers) ? mapOrLayers : record(mapOrLayers)?.layers;
  if (!Array.isArray(layers)) return undefined;
  for (const candidate of layers) {
    const layer = record(candidate);
    if (
      layer?.type !== "objectgroup" ||
      typeof layer.name !== "string" ||
      layer.name.toLowerCase() !== "objects" ||
      !Array.isArray(layer.properties)
    )
      continue;
    for (const candidateProperty of layer.properties) {
      const property = record(candidateProperty);
      if (
        property?.name === "officeEnvironmentVersion" &&
        property.type === "int" &&
        Number.isInteger(property.value) &&
        Number(property.value) > 0
      )
        return Number(property.value);
    }
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
