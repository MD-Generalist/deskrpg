import assert from "node:assert/strict";
import test from "node:test";

import { parsePluginInfo } from "./plugin-capability";
import { unreviewedProfiles } from "./review-hooks";

const body = (kanban: Record<string, unknown>, capabilities = ["kanban", "review_hooks_v1"]) => ({
  plugin: "deskrpg",
  version: "0.28.2",
  capabilities,
  kanban: { dispatcher_present: true, attachments: true, ...kanban },
});

test("the info parser keeps kanban.review_hooks, and tells an old body from a failed check", () => {
  const info = parsePluginInfo(
    body({ review_hooks: { propagation: false, profiles_without_plugin: ["noah", "sophie"] } }),
  );
  assert.deepEqual(info?.kanban.review_hooks, {
    propagation: false,
    profiles_without_plugin: ["noah", "sophie"],
  });
  assert.equal("review_hooks" in (parsePluginInfo(body({}))?.kanban ?? {}), false);
  assert.equal(parsePluginInfo(body({ review_hooks: null }))?.kanban.review_hooks, null);
});

test("profiles whose worker runs without the approval hooks — only where approvals are hooks", () => {
  const report = { propagation: false, profiles_without_plugin: ["noah", 7, "sophie"] };
  assert.deepEqual(unreviewedProfiles(parsePluginInfo(body({ review_hooks: report }))), [
    "noah",
    "sophie",
  ]);
  // Without review_hooks_v1 there is no approval policy to lose.
  assert.deepEqual(
    unreviewedProfiles(parsePluginInfo(body({ review_hooks: report }, ["kanban"]))),
    [],
  );
  assert.deepEqual(unreviewedProfiles(parsePluginInfo(body({ review_hooks: null }))), []);
  assert.deepEqual(unreviewedProfiles(null), []);
});
