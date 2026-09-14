import transport from "./internal-transport.js";
export type MapRefreshHandler = (
  action: "begin" | "finish",
  channelId: string,
  lease?: string,
) => Promise<string | null>;
const key = "__deskrpg_map_refresh__";
const registry = globalThis as typeof globalThis & { [key]?: MapRefreshHandler };
export function registerMapRefreshHandler(handler: MapRefreshHandler) {
  registry[key] = handler;
}
export async function requestMapRefresh(
  action: "begin" | "finish",
  channelId: string,
  lease?: string,
): Promise<string | null> {
  if (registry[key]) return registry[key](action, channelId, lease);
  const response = await fetch(`${transport.getInternalSocketBaseUrl()}/_internal/map-refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(transport.buildInternalAuthHeaders() as Record<string, string>),
    },
    body: JSON.stringify({ action, channelId, lease }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Map refresh unavailable");
  const result = await response.json();
  return typeof result.lease === "string" ? result.lease : null;
}
