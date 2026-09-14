import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupChannelMap } from "./channel-map-backup";
test("explicit durable directory retains exact SQLite value, excludes unrelated fields, is private and retry-safe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "map-backup-test-"));
  try {
    const row = {
      id: "../channel",
      updatedAt: "old",
      mapData: ' {"original":true} ',
      gatewayConfig: { secret: "excluded" },
    };
    assert.equal(await backupChannelMap(row, directory), true);
    assert.equal(await backupChannelMap(row, directory), true);
    const files = await readdir(directory);
    assert.equal(files.length, 2);
    for (const file of files) {
      const backup = JSON.parse(await readFile(join(directory, file), "utf8"));
      assert.equal(backup.mapData, row.mapData);
      assert.equal(backup.channelId, row.id);
      assert.equal(backup.gatewayConfig, undefined);
      assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("missing or relative backup destination fails closed", async () => {
  const row = { id: "channel", updatedAt: "old", mapData: {} };
  assert.equal(await backupChannelMap(row, ""), false);
  assert.equal(await backupChannelMap(row, "relative"), false);
  assert.equal(await backupChannelMap(row, "/not-existing/deskrpg-backup"), false);
});
