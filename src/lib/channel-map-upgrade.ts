import { upgradeOfficialEnvironmentMap } from "./official-environment-upgrade";
export type MapUpgradeRow = { id: string; mapData: unknown; updatedAt: unknown };
export type MapUpgradeDependencies<T extends MapUpgradeRow> = {
  backup(row: T): Promise<boolean>;
  begin(channelId: string): Promise<string | null>;
  save(selected: T, map: unknown): Promise<T | null>;
  refetch(): Promise<T | null>;
  finish(channelId: string, lease: string): Promise<void>;
};
/** Called only after authorization. Backup/coordination failure is a safe no-op. */
export async function resolveChannelMapUpgrade<T extends MapUpgradeRow>(
  selected: T,
  deps: MapUpgradeDependencies<T>,
): Promise<T | null> {
  const upgrade = upgradeOfficialEnvironmentMap(selected.mapData);
  if (!upgrade.upgraded) return selected;
  try {
    if (!(await deps.backup(selected))) return selected;
  } catch {
    return selected;
  }
  let lease: string | null;
  try {
    lease = await deps.begin(selected.id);
  } catch {
    return selected;
  }
  if (!lease) return selected;
  try {
    return (await deps.save(selected, upgrade.map)) ?? (await deps.refetch());
  } finally {
    await deps.finish(selected.id, lease);
  }
}
