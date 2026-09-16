import assert from "node:assert/strict";
import test from "node:test";

import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";

import {
  activeAssigneeOptions,
  assigneeLabel,
  BLACKBOARD_PREFIX,
  classifyBoardFailure,
  elapsedSeconds,
  EMPTY_TASK_FORM,
  failureLine,
  formatElapsed,
  KANBAN_COLUMN_ORDER,
  npcIdForAssignee,
  orderColumns,
  parseSkills,
  PLUGIN_INSTALL_COMMAND,
  progressLabel,
  splitBlackboardComments,
  taskFormToBody,
  warningBadge,
  type BoardNpc,
} from "./kanban-view-model";
import type { KanbanComment } from "@/lib/hermes/deskrpg-plugin-types";

const task = (id: string, status: KanbanTask["status"], extra: Partial<KanbanTask> = {}) =>
  ({ id, title: id, status, ...extra }) satisfies KanbanTask;

const npcs: BoardNpc[] = [
  { npcId: "n1", npcName: "소피", profileName: "sophie", active: true },
  { npcId: "n2", npcName: "잠든 NPC", profileName: "sleepy", active: false },
];

test("R6: columns come out in the fixed order, missing ones filled, unknown ones dropped", () => {
  const ordered = orderColumns(
    [
      { name: "done", tasks: [task("d", "done")] },
      { name: "triage", tasks: [task("t", "triage")] },
      { name: "made_up", tasks: [task("x", "todo")] },
      { name: "archived", tasks: [task("a", "archived")] },
    ],
    false,
  );
  assert.deepEqual(
    ordered.map((c) => c.name),
    KANBAN_COLUMN_ORDER.filter((n) => n !== "archived"),
  );
  assert.deepEqual(
    ordered[0].tasks.map((t) => t.id),
    ["t"],
  );
  assert.deepEqual(
    ordered.find((c) => c.name === "done")?.tasks.map((t) => t.id),
    ["d"],
  );
  assert.ok(ordered.every((c) => c.name !== ("made_up" as string)));
});

test("R6: archived column appears only with include_archived", () => {
  const columns = [{ name: "archived", tasks: [task("a", "archived")] }];
  assert.equal(
    orderColumns(columns, false).some((c) => c.name === "archived"),
    false,
  );
  const withArchived = orderColumns(columns, true);
  assert.equal(withArchived[withArchived.length - 1].name, "archived");
  assert.equal(withArchived.length, KANBAN_COLUMN_ORDER.length);
});

test("R7: assignee options are active NPCs only; labels fall back to the profile name", () => {
  assert.deepEqual(
    activeAssigneeOptions(npcs).map((n) => n.npcId),
    ["n1"],
  );
  assert.equal(assigneeLabel("sophie", npcs), "소피");
  assert.equal(assigneeLabel("sleepy", npcs), "잠든 NPC");
  assert.equal(assigneeLabel("outsider", npcs), "outsider");
  assert.equal(assigneeLabel(undefined, npcs), null);
  assert.equal(npcIdForAssignee("sophie", npcs), "n1");
  assert.equal(npcIdForAssignee("outsider", npcs), null);
});

test("card summary helpers: progress, warnings, elapsed", () => {
  assert.equal(progressLabel({ progress: { done: 2, total: 5 } }), "2/5");
  assert.equal(progressLabel({ progress: { done: 0, total: 0 } }), null);
  assert.equal(progressLabel({}), null);

  assert.deepEqual(warningBadge({ warnings: { count: 3, highest_severity: "critical" } }), {
    count: 3,
    severity: "critical",
  });
  assert.deepEqual(warningBadge({ warnings: { count: 1, highest_severity: "weird" } }), {
    count: 1,
    severity: "warning",
  });
  assert.equal(warningBadge({ warnings: { count: 0 } }), null);

  const started = "2026-09-14T10:00:00.000Z";
  assert.equal(elapsedSeconds({ started_at: started }, Date.parse("2026-09-14T10:01:05Z")), 65);
  assert.equal(
    elapsedSeconds({ started_at: started, last_heartbeat_at: "2026-09-14T10:10:00Z" }),
    600,
  );
  assert.equal(elapsedSeconds({}), null);
  assert.equal(formatElapsed(65), "1m 05s");
  assert.equal(formatElapsed(3725), "1h 02m");
  assert.equal(formatElapsed(9), "9s");
});

test("R31/R32: board failures classify into upgrade / gateway / board / other", () => {
  const upgrade = classifyBoardFailure({
    status: 428,
    code: "plugin_upgrade_required",
    message: "x",
    minVersion: "0.7.0",
  });
  assert.deepEqual(upgrade, {
    kind: "upgrade_required",
    minVersion: "0.7.0",
    command: PLUGIN_INSTALL_COMMAND,
  });
  assert.match(PLUGIN_INSTALL_COMMAND, /hermes plugins install .*deskrpg-hermes-plugin/);
  assert.match(PLUGIN_INSTALL_COMMAND, /hermes plugins enable deskrpg/);
  const fallback = classifyBoardFailure(
    { status: 428, code: "plugin_upgrade_required", message: "" },
    "0.6.0",
  );
  assert.equal(fallback.kind === "upgrade_required" ? fallback.minVersion : null, "0.6.0");
  assert.deepEqual(classifyBoardFailure({ status: 409, code: "gateway_not_bound", message: "" }), {
    kind: "gateway_not_bound",
  });
  assert.deepEqual(
    classifyBoardFailure({ status: 503, code: "board_create_failed", message: "disk full" }),
    { kind: "board_unavailable", code: "board_create_failed", reason: "disk full" },
  );
  assert.deepEqual(classifyBoardFailure({ status: 403, code: "not_a_member", message: "nope" }), {
    kind: "other",
    status: 403,
    code: "not_a_member",
    message: "nope",
  });
  assert.equal(failureLine({ code: "x", message: "why" }), "x: why");
  assert.equal(failureLine({ code: "x", message: "x" }), "x");
});

test("R8: form → body sends only filled fields, assignee as npcId, skills split", () => {
  assert.deepEqual(taskFormToBody({ ...EMPTY_TASK_FORM, title: "  hi  " }), { title: "hi" });
  const body = taskFormToBody({
    ...EMPTY_TASK_FORM,
    title: "t",
    body: "desc",
    assigneeNpcId: "n1",
    priority: "2",
    parents: ["p1"],
    workspaceKind: "worktree",
    workspacePath: "/repo",
    skills: "a, b,\nc",
    modelOverride: "gpt",
    providerOverride: "openai",
    reasoningEffort: "high",
    maxRuntimeSeconds: "120",
    goalMode: true,
    goalMaxTurns: "8",
  });
  assert.deepEqual(body, {
    title: "t",
    body: "desc",
    assignee: "n1",
    priority: "2",
    parents: ["p1"],
    workspace_kind: "worktree",
    workspace_path: "/repo",
    skills: ["a", "b", "c"],
    model_override: "gpt",
    provider_override: "openai",
    reasoning_effort: "high",
    max_runtime_seconds: 120,
    goal_mode: true,
    goal_max_turns: 8,
  });
  // goal_max_turns is dropped when goal mode is off
  assert.equal(
    "goal_max_turns" in taskFormToBody({ ...EMPTY_TASK_FORM, title: "t", goalMaxTurns: "3" }),
    false,
  );
  assert.deepEqual(parseSkills(" , x ,, y\n"), ["x", "y"]);
});

const bb = (key: string, value: unknown, author = "swarm-orchestrator") => ({
  id: `${key}-c`,
  author,
  body: `[swarm:blackboard] ${JSON.stringify({ key, value })}`,
  created_at: "2026-09-16T00:00:00Z",
});

test("블랙보드 코멘트는 스레드에서 빠지고 표로 병합된다", () => {
  const out = splitBlackboardComments([
    { id: "c1", author: "nova", body: "사람 코멘트", created_at: "2026-09-16T00:00:00Z" },
    bb("topology", { goal: "g" }),
    bb("progress", { done: 1 }),
  ] as KanbanComment[]);
  assert.deepEqual(
    out.comments.map((c) => c.id),
    ["c1"],
  );
  assert.deepEqual(out.blackboard, { topology: { goal: "g" }, progress: { done: 1 } });
  assert.equal(out.authors.topology, "swarm-orchestrator");
});

test("같은 key 는 나중 값이 이긴다", () => {
  const out = splitBlackboardComments([
    bb("progress", { done: 1 }, "nova"),
    bb("progress", { done: 2 }, "luna"),
  ] as KanbanComment[]);
  assert.deepEqual(out.blackboard, { progress: { done: 2 } });
  assert.equal(out.authors.progress, "luna");
});

test("깨진 JSON 은 조용히 무시하되 스레드에도 안 남긴다", () => {
  // Hermes `latest_blackboard` 와 같은 동작. 접두사가 붙은 이상 사람에게 보일 것은 아니다.
  const out = splitBlackboardComments([
    { id: "bad", author: "nova", body: "[swarm:blackboard] {깨짐", created_at: "x" },
  ] as KanbanComment[]);
  assert.deepEqual(out.comments, []);
  assert.deepEqual(out.blackboard, {});
});

test("key 가 문자열이 아니면 병합하지 않는다", () => {
  const out = splitBlackboardComments([
    { id: "n", author: "nova", body: '[swarm:blackboard] {"key": 1, "value": 2}', created_at: "x" },
  ] as KanbanComment[]);
  assert.deepEqual(out.blackboard, {});
});

test("블랙보드가 없으면 빈 객체다", () => {
  const out = splitBlackboardComments([
    { id: "c1", author: "nova", body: "보통 코멘트", created_at: "x" },
  ] as KanbanComment[]);
  assert.deepEqual(out.blackboard, {});
  assert.equal(out.comments.length, 1);
});
