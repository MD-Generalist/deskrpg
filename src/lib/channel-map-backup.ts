import { open, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { MapUpgradeRow } from "./channel-map-upgrade";

/** Setting this directory asserts that the operator mounted durable backup storage.
 * No default: ephemeral container disks must never silently enable migration.
 * Both file contents and directory entry are fsynced before returning success.
 */
export async function backupChannelMap(
  row: MapUpgradeRow,
  directory = process.env.DESKRPG_MAP_BACKUP_DIR,
): Promise<boolean> {
  if (!directory || !isAbsolute(directory)) return false;
  const stem = createHash("sha256").update(row.id).digest("hex");
  const path = join(directory, `${stem}-${randomUUID()}.json`),
    temporary = `${path}.pending`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          format: "deskrpg-map-backup-v1",
          sourceCommit: "5d836178",
          channelId: row.id,
          updatedAt: row.updatedAt,
          mapData: row.mapData,
        }) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const folder = await open(directory, "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
    return true;
  } catch {
    await unlink(temporary).catch(() => {});
    return false;
  }
}
