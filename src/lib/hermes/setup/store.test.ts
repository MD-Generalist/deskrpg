import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SetupJobStore } from "./store";
test("jobs are owner scoped, survive recreation and preserve cancellation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-jobs-"));
  try {
    const store = new SetupJobStore(dir);
    const job = store.create("alice");
    assert.throws(() => store.get("bob", job.id), /setup_not_found/);
    assert.throws(() => store.get("alice", "../../etc/passwd"), /setup_not_found/);
    store.cancel("alice", job.id);
    store.update("alice", job.id, { steps: ["installing_plugin"] });
    const restored = new SetupJobStore(dir);
    assert.equal(restored.cancelled("alice", job.id), true);
    assert.deepEqual(restored.get("alice", job.id).steps, ["installing_plugin"]);
    assert.equal(
      JSON.parse(readFileSync(path.join(dir, readdirSync(dir)[0]), "utf8")).job.id,
      job.id,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("target lock rejects simultaneous prepare and can be released", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-lock-"));
  try {
    const store = new SetupJobStore(dir);
    const release = store.lock("local");
    assert.throws(() => new SetupJobStore(dir).lock("local"), /setup_busy/);
    release();
    store.lock("local")();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
