import test from "node:test";
import assert from "node:assert/strict";

import { requireFeature, requireOwner, type SkillContext } from "./skill-access";
import { NO_SKILL_FEATURES } from "./skill-features";

const ctx = (over: Partial<SkillContext> = {}): SkillContext => ({
  userId: "u",
  channelId: "c",
  npcId: "n",
  profileName: "sophie",
  isGatewayOwner: true,
  capabilityReady: true,
  features: { read: true, edit: true, hub: true, curator: true, graph: true },
  client: {} as SkillContext["client"],
  gatewayId: "g",
  ...over,
});

test("a plugin without skill management yields 428 upgrade with the minimum version", async () => {
  const res = requireFeature(ctx({ capabilityReady: false, features: NO_SKILL_FEATURES }), "read");
  assert.equal(res?.status, 428);
  const body = await res!.json();
  assert.equal(body.code, "plugin_upgrade_required");
  assert.equal(body.minVersion, "0.15.0");
  assert.deepEqual(body.missing, ["profile_skill_admin"]);
  assert.equal(requireFeature(ctx(), "read"), null);
});

test("one feature off on a newer plugin is unavailable, not an upgrade", async () => {
  const res = requireFeature(
    ctx({ features: { read: true, edit: true, hub: false, curator: true, graph: true } }),
    "hub",
  );
  assert.equal(res?.status, 428);
  const body = await res!.json();
  assert.equal(body.code, "skill_feature_unavailable");
  assert.deepEqual(body.missing, ["profile_skill_hub"]);
});

test("a non-owner gets 403 forbidden", async () => {
  const res = requireOwner(ctx({ isGatewayOwner: false }));
  assert.equal(res?.status, 403);
  assert.equal((await res!.json()).code, "forbidden");
  assert.equal(requireOwner(ctx()), null);
});
