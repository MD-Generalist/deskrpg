import assert from "node:assert/strict";
import { test } from "node:test";

import { PINNED_PLUGIN_SETUP_COMMAND, PLUGIN_INSTALL_COMMAND } from "./plugin-install-command";
import { PLUGIN_PIN } from "./setup/pin";

const REPO = "https://github.com/dandacompany/deskrpg-hermes-plugin";

test("the setup command disables, force-installs the pin, enables, then restarts", () => {
  assert.equal(
    PINNED_PLUGIN_SETUP_COMMAND,
    `hermes plugins disable deskrpg >/dev/null 2>&1; hermes plugins install ${REPO} --ref ${PLUGIN_PIN} --force --no-enable && hermes plugins enable deskrpg && hermes gateway restart`,
  );
});

test("the steps run in the order upstream Hermes needs", () => {
  const positions = [
    "hermes plugins disable deskrpg",
    "hermes plugins install",
    "hermes plugins enable deskrpg",
    "hermes gateway restart",
  ].map((step) => PINNED_PLUGIN_SETUP_COMMAND.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
});

test("a failed disable on a fresh host does not stop the install", () => {
  assert.match(
    PINNED_PLUGIN_SETUP_COMMAND,
    /disable deskrpg >\/dev\/null 2>&1; hermes plugins install/,
  );
});

test("a failed install never reaches enable or restart", () => {
  assert.match(
    PINNED_PLUGIN_SETUP_COMMAND,
    /--no-enable && hermes plugins enable deskrpg && hermes gateway restart$/,
  );
  assert.doesNotMatch(PINNED_PLUGIN_SETUP_COMMAND, /\|\|/);
});

test("the missing-or-outdated screens show the same pinned command", () => {
  assert.equal(PLUGIN_INSTALL_COMMAND, PINNED_PLUGIN_SETUP_COMMAND);
});
