import assert from "node:assert/strict";
import test from "node:test";

import { hubUpdateOutcome } from "./hub-update-outcome";

test("reads the Hermes `skills update` summary line", () => {
  assert.equal(hubUpdateOutcome("No updates available.\n"), "none");
  assert.equal(hubUpdateOutcome("Updating: pdf\n...\nUpdated 1 skill(s).\n"), "updated");
  assert.equal(
    hubUpdateOutcome(
      "Skipping: pdf — you have local edits (update would overwrite them).\n" +
        "1 skill(s) kept your local edits: pdf.\nOverwrite with: hermes skills update <name> --force\n",
    ),
    "kept_local",
  );
});

test("colour codes around the summary do not hide it, and unknown output is null", () => {
  assert.equal(hubUpdateOutcome("\u001b[2mNo updates available.\u001b[0m\n"), "none");
  assert.equal(hubUpdateOutcome(""), null);
  assert.equal(hubUpdateOutcome("something else"), null);
});
