import test from "node:test";
import assert from "node:assert/strict";

import { isOldComposeInstall } from "./compose-install";
import { PLUGIN_PIN, PLUGIN_VERSION } from "./setup/pin";

const base = {
  baseUrl: "http://hermes:8642",
  pluginStatus: "plugin_ready",
  pluginVersion: PLUGIN_VERSION,
  pluginCommit: PLUGIN_PIN as string | null,
};

test("a Compose gateway running the pinned commit is the current compose", () => {
  assert.equal(isOldComposeInstall(base), false);
});

test("a Compose gateway running another commit at the same version is an old compose", () => {
  assert.equal(isOldComposeInstall({ ...base, pluginCommit: "f".repeat(40) }), true);
});

test("without a commit (a plugin before 0.30.0) only a version above the pin proves it", () => {
  assert.equal(isOldComposeInstall({ ...base, pluginCommit: null }), false);
  assert.equal(isOldComposeInstall({ ...base, pluginCommit: null, pluginVersion: "0.0.1" }), false);
  assert.equal(isOldComposeInstall({ ...base, pluginCommit: null, pluginVersion: "99.0.0" }), true);
});

test("only Compose gateways with a ready plugin are judged", () => {
  const other = { ...base, pluginCommit: "f".repeat(40) };
  assert.equal(
    isOldComposeInstall({ ...other, baseUrl: "http://host.docker.internal:8642" }),
    false,
  );
  assert.equal(isOldComposeInstall({ ...other, baseUrl: "http://127.0.0.1:8642" }), false);
  assert.equal(isOldComposeInstall({ ...other, pluginStatus: "plugin_absent" }), false);
});
