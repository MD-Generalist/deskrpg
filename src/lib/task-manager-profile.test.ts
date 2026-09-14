import test from "node:test";
import assert from "node:assert/strict";
import { setupThrowawaySqlite, seedChannelWithProfiles } from "@/test-setup/npc-seed";
setupThrowawaySqlite("task-profile-name");
import { db, tasks, npcs, hermesProfiles, characters } from "@/db";
import { eq } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TaskManager } = require("./task-manager.js");

test("channel tasks resolve assigned profile display names and preserve backlog through rename/fallback", async () => {
  const seed = await seedChannelWithProfiles({ placedActive: 1, displayName: "Profile Jun" });
  const [character] = await db
    .insert(characters)
    .values({ userId: seed.userId, name: "Tester", appearance: "{}" })
    .returning();
  const manager = new TaskManager(db, { tasks, npcs, hermesProfiles });
  const backlog = await manager.createBacklogTask(
    seed.channelId,
    character.id,
    "Original backlog",
    null,
  );
  const moved = await manager.moveTask(backlog.id, seed.channelId, "in_progress", seed.npcIds[0]);
  assert.equal(moved.id, backlog.id);
  let list = await manager.getTasksByChannel(seed.channelId);
  assert.equal(list[0].npcName, "Profile Jun");
  const [npc] = await db.select().from(npcs).where(eq(npcs.id, seed.npcIds[0]));
  await db
    .update(hermesProfiles)
    .set({ displayName: "Renamed profile" })
    .where(eq(hermesProfiles.id, npc.hermesProfileId));
  list = await manager.getTasksByChannel(seed.channelId);
  assert.equal(list[0].npcName, "Renamed profile");
  await db
    .update(hermesProfiles)
    .set({ displayName: "  " })
    .where(eq(hermesProfiles.id, npc.hermesProfileId));
  const [profile] = await db
    .select()
    .from(hermesProfiles)
    .where(eq(hermesProfiles.id, npc.hermesProfileId));
  list = await manager.getTasksByChannel(seed.channelId);
  assert.equal(list[0].npcName, profile.profileName);
  assert.equal(list[0].id, backlog.id);
});

for (const terminal of ["complete", "cancelled"]) {
  test(`late agent create/update cannot reopen a manually ${terminal} task`, async () => {
    const seed = await seedChannelWithProfiles({ placedActive: 1 });
    const [character] = await db
      .insert(characters)
      .values({ userId: seed.userId, name: "Tester", appearance: "{}" })
      .returning();
    const manager = new TaskManager(db, { tasks, npcs, hermesProfiles });
    const backlog = await manager.createBacklogTask(
      seed.channelId,
      character.id,
      "Keep manual result",
      null,
    );
    await manager.moveTask(backlog.id, seed.channelId, "in_progress", seed.npcIds[0]);
    if (terminal === "complete") await manager.completeTask(backlog.id, seed.channelId);
    else await manager.moveTask(backlog.id, seed.channelId, "cancelled", null);
    const before = await manager.getTaskById(backlog.id, seed.channelId);
    for (const action of ["update", "create", "complete", "cancel"]) {
      const result = await manager.handleTaskAction(
        {
          action,
          id: backlog.npcTaskId,
          title: "Late agent title",
          summary: "Late output",
          status: "in_progress",
        },
        seed.channelId,
        seed.npcIds[0],
        character.id,
      );
      assert.equal(result, null, "ignored agent output must not emit another task update");
      assert.deepEqual(await manager.getTaskById(backlog.id, seed.channelId), before);
    }
    // A user's explicit board move remains an intentional reopening path.
    await manager.moveTask(backlog.id, seed.channelId, "in_progress", seed.npcIds[0]);
    const accepted = await manager.handleTaskAction(
      {
        action: "update",
        id: backlog.npcTaskId,
        summary: "New work after explicit resume",
        status: "in_progress",
      },
      seed.channelId,
      seed.npcIds[0],
      character.id,
    );
    assert.equal(accepted.id, backlog.id);
    assert.equal(accepted.status, "in_progress");
  });
}
