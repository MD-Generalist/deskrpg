import test from "node:test";
import assert from "node:assert/strict";
import fixture from "../../../lib/fixtures/official-agency-v2.json";
import { resolveChannelMapUpgrade } from "../../../lib/channel-map-upgrade";
import { normalizeMeetingMap } from "../../../game/meeting-map-normalization";
import { mapContentRevision } from "../../../lib/channel-map-revision";
const selected = {
  id: "channel",
  mapData: fixture as unknown,
  updatedAt: "old",
  mapConfig: { spawnCol: 15 },
  gatewayConfig: { untouched: true },
  name: "keep",
  ownerId: "owner",
};
test("backs up before coordinated CAS and preserves every non-map field", async () => {
  const events: string[] = [];
  const result = await resolveChannelMapUpgrade(selected, {
    backup: async (row) => {
      assert.equal(row, selected);
      events.push("backup");
      return true;
    },
    begin: async () => {
      events.push("begin");
      return "lease";
    },
    save: async (row, map) => {
      assert.equal(row, selected);
      events.push("save");
      return { ...selected, mapData: map, updatedAt: "new" };
    },
    refetch: async () => {
      throw Error("unexpected");
    },
    finish: async () => {
      events.push("finish");
    },
  });
  assert.deepEqual(events, ["backup", "begin", "save", "finish"]);
  assert.equal((result!.mapData as { width: number }).width, 42);
  for (const key of ["id", "mapConfig", "gatewayConfig", "name", "ownerId"] as const)
    assert.deepEqual(result![key], selected[key]);
});
test("lost race refetches editor save and never retries overwriting it", async () => {
  const edited = { ...selected, mapData: { edited: true }, updatedAt: "editor" };
  let saves = 0;
  const result = await resolveChannelMapUpgrade(selected, {
    backup: async () => true,
    begin: async () => "lease",
    save: async () => {
      saves++;
      return null;
    },
    refetch: async () => edited,
    finish: async () => {},
  });
  assert.equal(result, edited);
  assert.equal(saves, 1);
});
for (const backup of [
  async () => false,
  async () => {
    throw Error("disk failed");
  },
])
  test("backup failure returns untouched row and never starts migration", async () => {
    const unexpected = async () => {
      throw Error("must not run");
    };
    assert.equal(
      await resolveChannelMapUpgrade(selected, {
        backup,
        begin: unexpected,
        save: unexpected,
        refetch: unexpected,
        finish: unexpected,
      }),
      selected,
    );
  });
test("no live coordination lease means no write", async () => {
  const result = await resolveChannelMapUpgrade(selected, {
    backup: async () => true,
    begin: async () => null,
    save: async () => {
      throw Error("must not save");
    },
    refetch: async () => null,
    finish: async () => {
      throw Error("must not finish");
    },
  });
  assert.equal(result, selected);
});
test("deleted channel during race returns null and releases coordination", async () => {
  let finished = false;
  assert.equal(
    await resolveChannelMapUpgrade(selected, {
      backup: async () => true,
      begin: async () => "lease",
      save: async () => null,
      refetch: async () => null,
      finish: async () => {
        finished = true;
      },
    }),
    null,
  );
  assert.equal(finished, true);
});

import { NextRequest } from "next/server";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupThrowawaySqlite,
  seedUser,
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  authHeaders,
} from "../../../test-setup/npc-seed";
import { registerMapRefreshHandler } from "../../../lib/channel-map-refresh";
setupThrowawaySqlite("channel-map-upgrade");

test("real authorized SQLite GET backs up and changes only mapData/updatedAt; anonymous GET cannot migrate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "map-get-backup-"));
  process.env.DESKRPG_MAP_BACKUP_DIR = directory;
  try {
    const { db, channels, jsonForDb, npcs, hermesProfiles } = await import("../../../db");
    const { eq } = await import("drizzle-orm");
    const { GET } = await import("./[id]/route");
    const user = await seedUser();
    const channel = await seedChannel(user.id);
    const gateway = await seedGateway(user.id);
    const profile = await seedHermesProfile(gateway.id);
    await seedNpc({
      channelId: channel.id,
      hermesProfileId: profile.id,
      positionX: 999,
      positionY: 999,
    });
    const npcBefore = await db.select().from(npcs).where(eq(npcs.channelId, channel.id));
    const profileBefore = await db
      .select()
      .from(hermesProfiles)
      .where(eq(hermesProfiles.id, profile.id));
    await db
      .update(channels)
      .set({
        mapData: jsonForDb(fixture),
        mapConfig: jsonForDb({ cols: 30, rows: 22, spawnCol: 15, spawnRow: 19 }),
        description: "keep",
        gatewayConfig: jsonForDb({ custom: "preserve" }),
        updatedAt: "2026-01-01T00:00:00.000Z" as unknown as Date,
      })
      .where(eq(channels.id, channel.id));
    const [before] = await db.select().from(channels).where(eq(channels.id, channel.id));
    const phases: string[] = [];
    registerMapRefreshHandler(async (action) => {
      phases.push(action);
      return action === "begin" ? "test-lease" : null;
    });
    const context = { params: Promise.resolve({ id: channel.id }) };
    assert.equal(
      (await GET(new NextRequest("http://localhost/api/channels/" + channel.id), context)).status,
      401,
    );
    assert.deepEqual(await readdir(directory), []);
    const response = await GET(
      new NextRequest("http://localhost/api/channels/" + channel.id, {
        headers: authHeaders(user.id),
      }),
      context,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.channel.mapData.width, 42);
    assert.equal(body.channel.mapConfig.spawnCol, 15);
    const [after] = await db.select().from(channels).where(eq(channels.id, channel.id));
    for (const key of Object.keys(before) as Array<keyof typeof before>)
      if (key !== "mapData" && key !== "updatedAt") assert.deepEqual(after[key], before[key], key);
    assert.deepEqual(await db.select().from(npcs).where(eq(npcs.channelId, channel.id)), npcBefore);
    assert.deepEqual(
      await db.select().from(hermesProfiles).where(eq(hermesProfiles.id, profile.id)),
      profileBefore,
    );
    assert.deepEqual(phases, ["begin", "finish"]);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.equal(
      JSON.parse(await readFile(join(directory, files[0]), "utf8")).mapData,
      before.mapData,
    );
  } finally {
    delete process.env.DESKRPG_MAP_BACKUP_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});

test("real CAS loses to an editor even with identical updatedAt and returns the edited map", async () => {
  const directory = await mkdtemp(join(tmpdir(), "map-race-backup-"));
  process.env.DESKRPG_MAP_BACKUP_DIR = directory;
  try {
    const { db, channels, jsonForDb } = await import("../../../db");
    const { eq } = await import("drizzle-orm");
    const { GET } = await import("./[id]/route");
    const user = await seedUser();
    const channel = await seedChannel(user.id);
    await db
      .update(channels)
      .set({ mapData: jsonForDb(fixture) })
      .where(eq(channels.id, channel.id));
    const edited = { ...fixture, custom: "editor-wins" };
    registerMapRefreshHandler(async (action) => {
      if (action === "begin") {
        await db
          .update(channels)
          .set({ mapData: jsonForDb(edited) })
          .where(eq(channels.id, channel.id));
        return "race";
      }
      return null;
    });
    const response = await GET(
      new NextRequest("http://localhost/api/channels/" + channel.id, {
        headers: authHeaders(user.id),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );
    assert.equal(response.status, 200);
    const returned = (await response.json()).channel;
    const effective = normalizeMeetingMap(edited);
    assert.deepEqual(returned.mapData, effective.mapData);
    assert.deepEqual(returned.meetingSpace, effective.meetingSpace);
    assert.equal(returned.mapRevision, mapContentRevision(edited));
    const [saved] = await db.select().from(channels).where(eq(channels.id, channel.id));
    assert.deepEqual(JSON.parse(saved.mapData as string), edited);
  } finally {
    delete process.env.DESKRPG_MAP_BACKUP_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
