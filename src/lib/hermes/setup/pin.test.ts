import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { HOST_HELPER } from "./host-helper";
import { PLUGIN_PIN, PLUGIN_PIN_SHORT, PLUGIN_VERSION } from "./pin";

test("the host script's pinned commit matches the constant the UI reads", () => {
  // If the two diverge, the UI points to the old commit while actually installing something else.
  assert.ok(HOST_HELPER.includes(`PIN = '${PLUGIN_PIN}'`), "host-helper 의 PIN 이 다르다");
  assert.ok(
    HOST_HELPER.includes(`PLUGIN_VERSION = '${PLUGIN_VERSION}'`),
    "host-helper 의 PLUGIN_VERSION 이 다르다",
  );
});

test("the short form is the first 12 characters of the pinned commit", () => {
  assert.equal(PLUGIN_PIN_SHORT, PLUGIN_PIN.slice(0, 12));
  assert.match(PLUGIN_PIN, /^[0-9a-f]{40}$/);
});

test("the plugin install command in both READMEs uses the pinned commit", () => {
  // The READMEs are copied by hand; a pin bump that forgets them sends new users to an old plugin.
  const root = path.resolve(import.meta.dirname, "../../../..");
  for (const file of ["README.md", "README.ko.md"]) {
    const text = readFileSync(path.join(root, file), "utf8");
    const refs = [...text.matchAll(/deskrpg-hermes-plugin --ref (\S+)/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${file} has no plugin install command`);
    for (const ref of refs) assert.equal(ref, PLUGIN_PIN, `${file} installs ${ref}`);
  }
});

/** Runs the `sed` a deployment uses to read the pin, against this repo's pin.ts. */
function readPinWith(script: string): string {
  const pinFile = path.resolve(import.meta.dirname, "pin.ts");
  return execFileSync("sh", ["-c", script], { env: { ...process.env, PIN_FILE: pinFile } })
    .toString()
    .trim();
}

test("both Compose stacks read the plugin pin from the DeskRPG image, and their sed yields PLUGIN_PIN", () => {
  // Hostinger's Update never re-reads the compose, so a commit written into it would freeze; the image moves
  // with every Update and rollback, so the pin comes from the image's own pin.ts.
  const root = path.resolve(import.meta.dirname, "../../../..");
  for (const file of ["docker-compose.yml", "docker/docker-compose.hermes.yml"]) {
    const text = readFileSync(path.join(root, file), "utf8");
    const line = /^ {6}- (sed -n .*src\/lib\/hermes\/setup\/pin\.ts) > \/pin\/ref$/m.exec(text);
    assert.ok(line, `${file} has no plugin-pin step`);
    const script = line[1]
      .replaceAll("$$", "$")
      .replace("src/lib/hermes/setup/pin.ts", '"$PIN_FILE"');
    assert.equal(readPinWith(script), PLUGIN_PIN, file);
    const plugins = text.slice(text.indexOf("  hermes-plugins:"), text.indexOf("\n  hermes:"));
    assert.match(plugins, /plugin-pin:\s*\n\s*condition: service_completed_successfully/, file);
    assert.match(plugins, /- plugin-pin:\/pin:ro/, file);
    assert.match(plugins, /hermes plugins install \$\$u --ref "\$\$pin" --force/, file);
    assert.doesNotMatch(text, /hermes plugins update/, file);
    // A new image (Update, rollback) re-runs the one-shots; Hermes must restart to serve what they installed.
    const hermes = text.slice(text.indexOf("\n  hermes:"));
    assert.match(
      hermes,
      /plugin-pin:\s*\n\s*condition: service_completed_successfully\s*\n\s*restart: true/,
      file,
    );
  }
});

test("the all-in-one image reads the plugin pin from the installed DeskRPG package", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const text = readFileSync(path.join(root, "deploy/office/cont-init.d/03-deskrpg-setup"), "utf8");
  assert.match(
    text,
    /PIN_FILE="\$\(npm root -g[^)]*\)\/deskrpg\/src\/lib\/hermes\/setup\/pin\.ts"/,
  );
  const line = /^PIN="\$\((sed -n .*"\$PIN_FILE") 2>\/dev\/null \|\| true\)"$/m.exec(text);
  assert.ok(line, "no pin sed in the init script");
  assert.equal(readPinWith(line[1]), PLUGIN_PIN);
  assert.match(text, /hermes plugins install "\$PLUGIN_SOURCE" --ref "\$PIN" --force/);
});
