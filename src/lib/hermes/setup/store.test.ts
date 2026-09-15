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

test("재개는 같은 사용자·같은 대상·실패한 잡에만 허용된다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-resume-"));
  try {
    const store = new SetupJobStore(dir);
    const job = store.create("alice", '{"mode":"local"}');
    // 아직 도는 잡은 이어받을 것이 없다.
    assert.throws(() => store.resumable("alice", job.id, '{"mode":"local"}'), /setup_not_found/);
    store.update("alice", job.id, {
      status: "failed",
      error: "plugin_install_failed",
      completed: ["inspecting", "creating_profile"],
    });
    assert.deepEqual(store.resumable("alice", job.id, '{"mode":"local"}').completed, [
      "inspecting",
      "creating_profile",
    ]);
    // 남의 잡·다른 대상·성공한 잡은 존재 여부조차 알려 주지 않는다.
    assert.throws(() => store.resumable("bob", job.id, '{"mode":"local"}'), /setup_not_found/);
    assert.throws(
      () => store.resumable("alice", job.id, '{"mode":"ssh","hostId":"dev"}'),
      /setup_not_found/,
    );
    store.update("alice", job.id, { status: "succeeded" });
    assert.throws(() => store.resumable("alice", job.id, '{"mode":"local"}'), /setup_not_found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("재개 잡은 앞선 잡이 끝낸 단계를 물려받고 시작한다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-seed-"));
  try {
    const store = new SetupJobStore(dir);
    const resumed = store.create("alice", '{"mode":"local"}', {
      completed: ["inspecting", "inspecting", "installing_hermes"],
    });
    assert.deepEqual(resumed.completed, ["inspecting", "installing_hermes"]);
    // 화면이 보는 "건너뜀" 은 completed 에 있으면서 steps 에 없는 단계다.
    assert.deepEqual(resumed.steps, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
