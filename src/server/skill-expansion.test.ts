import assert from "node:assert/strict";
import test from "node:test";
import {
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
  startStubHermesGateway,
} from "@/test-setup/npc-seed";

setupThrowawaySqlite("skill-expansion");

import { startFakePluginServer } from "@/lib/hermes/fake-plugin-server";
import {
  expandSkillMessage,
  formatRoomSkillLine,
  splitLeadingMentions,
  validateSkillChips,
} from "./skill-expansion";

const PROFILE_TOKEN = "profile-key-1234567890";
const OWNER_TOKEN = "gateway-owner-key-1234567890";
const CAPABLE = { capabilities: ["kanban", "cron", "events", "skill_invocation"] };

/** A channel bound to `baseUrl` with one hired employee on profile `noah`. */
async function seedEmployee(baseUrl: string) {
  const owner = await seedUser("skill-exp");
  const gateway = await seedGateway(owner.id, baseUrl);
  const channel = await seedChannel(owner.id, "chips");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, { profileName: "noah" });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profile.id,
    name: "Noah",
    positionX: 0,
    positionY: 0,
    active: true,
  });
  return { channelId: channel.id, npcId: npc.id };
}

test("validateSkillChips normalizes names and refuses too many or malformed ones", () => {
  assert.deepEqual(validateSkillChips(["/research", "research", " write-report "]), {
    ok: true,
    skills: ["research", "write-report"],
  });
  assert.deepEqual(validateSkillChips(["a1", "a2", "a3", "a4", "a5", "a6"]), {
    ok: false,
    errorCode: "too_many_skills",
  });
  assert.deepEqual(validateSkillChips(["a b"]), { ok: false, errorCode: "skill_not_found" });
  assert.deepEqual(validateSkillChips(["../x"]), { ok: false, errorCode: "skill_not_found" });
  assert.deepEqual(validateSkillChips([42]), { ok: false, errorCode: "skill_not_found" });
  assert.deepEqual(validateSkillChips("research"), { ok: true, skills: [] });
});

test("a room line puts the chips after the leading mentions and before the instruction", () => {
  assert.deepEqual(splitLeadingMentions("@[Sophie]  do it"), {
    prefix: "@[Sophie]",
    rest: "do it",
  });
  assert.deepEqual(splitLeadingMentions("hey @[Sophie] do it"), {
    prefix: "",
    rest: "hey @[Sophie] do it",
  });
  assert.equal(formatRoomSkillLine("@[Sophie]  do it", ["research"]), "@[Sophie] /research do it");
  assert.equal(
    formatRoomSkillLine("@[Sophie]", ["research", "write"]),
    "@[Sophie] /research /write",
  );
  assert.equal(formatRoomSkillLine("hey @[Sophie] go", ["research"]), "/research hey @[Sophie] go");
  assert.equal(formatRoomSkillLine("@[So\\]phie] go", ["research"]), "@[So\\]phie] /research go");
});

test("expands through the profile's plugin route and passes the instruction through", async (t) => {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { noah: PROFILE_TOKEN },
    info: CAPABLE,
  });
  t.after(() => server.close());
  server.skills("noah").seed("research");
  server.skills("noah").seed("write-report");
  const { channelId, npcId } = await seedEmployee(server.baseUrl);

  const single = await expandSkillMessage({
    channelId,
    npcId,
    skills: ["research"],
    instruction: "go",
  });
  assert.deepEqual(single, { ok: true, message: "[skills: research] go" });
  const stacked = await expandSkillMessage({
    channelId,
    npcId,
    skills: ["/research", "write-report"],
    instruction: "",
  });
  assert.deepEqual(stacked, { ok: true, message: "[skills: research, write-report]" });
  assert.deepEqual(server.skills("noah").invocations, [
    { skills: ["research"], instruction: "go" },
    { skills: ["research", "write-report"], instruction: "" },
  ]);
});

test("the plugin's 404, 409 and 422 become skill_not_found, skill_disabled and skill_load_failed", async (t) => {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { noah: PROFILE_TOKEN },
    info: CAPABLE,
  });
  t.after(() => server.close());
  const state = server.skills("noah");
  state.seed("research");
  state.seed("old");
  state.skills.get("old")!.disabled = true;
  const { channelId, npcId } = await seedEmployee(server.baseUrl);

  assert.deepEqual(
    await expandSkillMessage({ channelId, npcId, skills: ["nope"], instruction: "x" }),
    {
      ok: false,
      errorCode: "skill_not_found",
    },
  );
  assert.deepEqual(
    await expandSkillMessage({ channelId, npcId, skills: ["old"], instruction: "x" }),
    {
      ok: false,
      errorCode: "skill_disabled",
    },
  );
  state.invocationFailure = { status: 422, error: "skill_load_failed" };
  assert.deepEqual(
    await expandSkillMessage({ channelId, npcId, skills: ["research"], instruction: "x" }),
    { ok: false, errorCode: "skill_load_failed" },
  );
});

test("too many or malformed chips are refused without calling the plugin", async (t) => {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { noah: PROFILE_TOKEN },
    info: CAPABLE,
  });
  t.after(() => server.close());
  const { channelId, npcId } = await seedEmployee(server.baseUrl);

  assert.deepEqual(
    await expandSkillMessage({
      channelId,
      npcId,
      skills: ["a1", "a2", "a3", "a4", "a5", "a6"],
      instruction: "x",
    }),
    { ok: false, errorCode: "too_many_skills" },
  );
  assert.deepEqual(
    await expandSkillMessage({ channelId, npcId, skills: ["a b"], instruction: "x" }),
    {
      ok: false,
      errorCode: "skill_not_found",
    },
  );
  assert.deepEqual(await expandSkillMessage({ channelId, npcId, skills: [], instruction: "x" }), {
    ok: false,
    errorCode: "skill_not_found",
  });
  assert.deepEqual(server.skills("noah").invocations, []);
});

test("a plugin without the capability is plugin_update_required; one that is not loaded is plugin_not_loaded", async (t) => {
  const old = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { noah: PROFILE_TOKEN },
    info: { capabilities: ["kanban", "cron", "events"] },
  });
  t.after(() => old.close());
  old.skills("noah").seed("research");
  const onOld = await seedEmployee(old.baseUrl);
  assert.deepEqual(await expandSkillMessage({ ...onOld, skills: ["research"], instruction: "x" }), {
    ok: false,
    errorCode: "plugin_update_required",
  });
  assert.deepEqual(old.skills("noah").invocations, []);

  // Installed but disabled (or enabled on a non-root profile): every /deskrpg/* route is a bare 404.
  const bare = await startStubHermesGateway();
  t.after(() => bare.close());
  const onBare = await seedEmployee(bare.baseUrl);
  assert.deepEqual(
    await expandSkillMessage({ ...onBare, skills: ["research"], instruction: "x" }),
    {
      ok: false,
      errorCode: "plugin_not_loaded",
    },
  );
});

test("an employee outside the channel or without a gateway cannot be expanded", async (t) => {
  const server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { noah: PROFILE_TOKEN },
    info: CAPABLE,
  });
  t.after(() => server.close());
  const { channelId } = await seedEmployee(server.baseUrl);
  assert.deepEqual(
    await expandSkillMessage({
      channelId,
      npcId: "nobody",
      skills: ["research"],
      instruction: "x",
    }),
    { ok: false, errorCode: "npc_not_found" },
  );
  const stranger = await seedUser("no-gateway");
  const unbound = await seedChannel(stranger.id, "unbound");
  assert.deepEqual(
    await expandSkillMessage({
      channelId: unbound.id,
      npcId: "nobody",
      skills: ["research"],
      instruction: "x",
    }),
    { ok: false, errorCode: "gateway_not_connected" },
  );
});
