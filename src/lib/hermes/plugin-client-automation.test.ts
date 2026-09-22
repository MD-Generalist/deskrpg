import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { startFakePluginServer, type FakePluginServer } from "./fake-plugin-server";
import { createOwnerPluginClient, createProfilePluginClient } from "./plugin-client";

// 오너 키 스코프(칸반·이벤트)와 프로필 키 스코프(크론)를 실제 클라이언트 → 가짜 플러그인
// 서버로 왕복시킨다. 가짜 서버는 스펙 A.1/A.2/A.3 을 재현할 뿐 해석하지 않는다 — 여기서
// 고정하는 것은 "어떤 경로에 어떤 키·어떤 본문이 나가고 어떤 모양이 돌아오는가" 다.

const OWNER = "owner-key-1234567890";
const SOPHIE = "sophie-key-0987654321";

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER,
    profileTokens: { sophie: SOPHIE },
  });
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
});

function owner() {
  return createOwnerPluginClient({ baseUrl: server.baseUrl, ownerToken: OWNER });
}

function sophie() {
  return createProfilePluginClient({
    baseUrl: server.baseUrl,
    profileName: "sophie",
    profileToken: SOPHIE,
  });
}

function unwrap<T>(res: { ok: true; data: T } | { ok: false; failure: { code: string } }): T {
  assert.equal(res.ok, true, res.ok ? "" : `unexpected failure: ${res.failure.code}`);
  if (!res.ok) throw new Error("unreachable");
  return res.data;
}

describe("owner client — info", () => {
  it("/deskrpg/info 를 오너 키로 부르고 계약 블록을 그대로 돌려준다", async () => {
    const info = unwrap(await owner().info());
    assert.equal(info.plugin, "deskrpg");
    assert.equal(info.version, "0.6.0");
    assert.deepEqual(info.capabilities, [
      "kanban",
      "cron",
      "events",
      "swarm",
      "kanban_views",
      "initial_status",
      "kanban_review_policy_v1",
    ]);
    assert.equal(info.timezone, "Asia/Seoul");
    assert.deepEqual(info.kanban, { dispatcher_present: true, attachments: true });
    assert.equal(server.lastRequest()?.auth, `Bearer ${OWNER}`);
  });

  it("가짜 서버의 버전·capabilities 를 바꿀 수 있다", async () => {
    server.setInfo({ version: "0.5.9", capabilities: ["kanban"] });
    const info = unwrap(await owner().info());
    assert.equal(info.version, "0.5.9");
    assert.deepEqual(info.capabilities, ["kanban"]);
  });
});

describe("auth — A.3", () => {
  it("오너 스코프에 프로필 키를 보내면 401 로 접힌다", async () => {
    const wrong = createOwnerPluginClient({ baseUrl: server.baseUrl, ownerToken: SOPHIE });
    const res = await wrong.kanban.listBoards();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 401);
    assert.equal(res.failure.code, "gateway_auth_failed");
  });

  it("프로필 스코프에 오너 키를 보내면 401 로 접힌다", async () => {
    const wrong = createProfilePluginClient({
      baseUrl: server.baseUrl,
      profileName: "sophie",
      profileToken: OWNER,
    });
    const res = await wrong.cron.listJobs();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 401);
    assert.equal(res.failure.code, "gateway_auth_failed");
  });

  it("모르는 프로필은 404 다", async () => {
    const ghost = createProfilePluginClient({
      baseUrl: server.baseUrl,
      profileName: "ghost",
      profileToken: SOPHIE,
    });
    const res = await ghost.cron.listJobs();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 404);
  });
});

describe("kanban — 보드", () => {
  it("생성 → 같은 slug 재생성은 200 + 기존 보드 → 목록·수정", async () => {
    const api = owner().kanban;
    const created = unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    assert.equal(created.board.slug, "dev");
    assert.equal(created.board.name, "Dev");
    assert.equal(server.lastRequest()?.status, 201);

    const again = unwrap(await api.createBoard({ slug: "dev", name: "다른 이름" }));
    assert.equal(again.board.name, "Dev", "기존 slug 는 덮어쓰지 않고 그대로 돌려준다");
    assert.equal(server.lastRequest()?.status, 200);

    const listed = unwrap(await api.listBoards());
    assert.deepEqual(
      listed.boards.map((b) => b.slug),
      ["dev"],
    );
    assert.equal(listed.current, "dev");

    const patched = unwrap(await api.updateBoard("dev", { description: "설명" }));
    assert.equal(patched.board.description, "설명");
    assert.equal(server.lastRequest()?.method, "PATCH");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/boards/dev");
  });

  it("slug 형식이 틀리면 400", async () => {
    const res = await owner().kanban.createBoard({ slug: "Bad Slug", name: "x" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
    assert.equal(res.failure.code, "invalid_slug");
  });
});

describe("kanban — 카드", () => {
  it("생성·조회·수정·코멘트·액션·삭제가 ?board= 를 달고 왕복한다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));

    const created = unwrap(
      await api.createTask("dev", { title: "첫 카드", body: "본문", assignee: "sophie" }),
    );
    assert.equal(created.task.title, "첫 카드");
    assert.equal(created.task.status, "todo");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/tasks?board=dev");
    const id = created.task.id;

    const board = unwrap(await api.getBoard("dev"));
    const todo = board.columns.find((c) => c.name === "todo");
    assert.ok(todo);
    assert.deepEqual(
      todo.tasks.map((t) => t.id),
      [id],
    );
    assert.deepEqual(board.assignees, ["sophie"]);
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/board?board=dev");

    const patched = unwrap(await api.updateTask("dev", id, { status: "ready", priority: "high" }));
    assert.equal(patched.task.status, "ready");
    assert.equal(patched.task.priority, "high");

    const comment = unwrap(await api.addComment("dev", id, { author: "dante", body: "메모" }));
    assert.equal(comment.comment.author, "dante");

    const detail = unwrap(await api.getTask("dev", id));
    assert.equal(detail.task.status, "ready");
    assert.equal(detail.comments.length, 1);
    assert.ok(detail.events.length >= 2, "생성·상태 변경 이벤트가 카드 이력에 남는다");
    assert.deepEqual(detail.links, { parents: [], children: [] });
    assert.deepEqual(detail.runs, []);
    assert.deepEqual(detail.attachments, []);

    const approved = unwrap(await api.runTaskAction("dev", id, "approve", {}));
    assert.equal(approved.task.status, "done");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/tasks/" + id + "/approve?board=dev");

    const reassigned = unwrap(
      await api.runTaskAction("dev", id, "reassign", { profile: "noah", reclaim_first: true }),
    );
    assert.equal(reassigned.task.assignee, "noah");
    assert.deepEqual(server.lastRequest()?.json, { profile: "noah", reclaim_first: true });

    const changes = unwrap(
      await api.runTaskAction("dev", id, "request-changes", { comment: "다시" }),
    );
    assert.equal(changes.task.status, "todo");

    const deleted = unwrap(await api.deleteTask("dev", id));
    assert.deepEqual(deleted, { ok: true });
    const gone = await api.getTask("dev", id);
    assert.equal(gone.ok, false);
    if (gone.ok) return;
    assert.equal(gone.status, 404);
    assert.equal(gone.failure.code, "not_found");
  });

  it("board 파라미터가 없거나 모르는 보드면 실패한다", async () => {
    const res = await owner().kanban.getBoard("nope");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 404);
  });

  it("include_archived 가 아니면 archived 카드는 보드에 안 실린다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const { task } = unwrap(await api.createTask("dev", { title: "보관" }));
    unwrap(await api.runTaskAction("dev", task.id, "archive", {}));

    const hidden = unwrap(await api.getBoard("dev"));
    assert.equal(hidden.columns.flatMap((c) => c.tasks).length, 0);
    const shown = unwrap(await api.getBoard("dev", { includeArchived: true }));
    assert.equal(shown.columns.flatMap((c) => c.tasks).length, 1);
    assert.equal(
      server.lastRequest()?.path,
      "/deskrpg/kanban/board?board=dev&include_archived=true",
    );
  });

  it("링크·디스패치·로그·오케스트레이션·프로필", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const parent = unwrap(await api.createTask("dev", { title: "부모" })).task;
    const child = unwrap(await api.createTask("dev", { title: "자식", parents: [parent.id] })).task;

    const detail = unwrap(await api.getTask("dev", child.id));
    assert.deepEqual(detail.links.parents, [parent.id]);

    unwrap(await api.removeLink("dev", { parent_id: parent.id, child_id: child.id }));
    assert.equal(server.lastRequest()?.method, "DELETE");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/links?board=dev");
    assert.deepEqual(unwrap(await api.getTask("dev", child.id)).links.parents, []);

    unwrap(await api.addLink("dev", { parent_id: parent.id, child_id: child.id }));
    assert.deepEqual(unwrap(await api.getTask("dev", parent.id)).links.children, [child.id]);

    unwrap(await api.updateTask("dev", parent.id, { status: "ready" }));
    const dispatched = unwrap(await api.dispatch("dev", { max: 2 }));
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/dispatch?board=dev&max=2");
    assert.deepEqual(
      dispatched.spawned.map((s) => s.task_id),
      [parent.id],
    );
    const running = unwrap(await api.getTask("dev", parent.id));
    assert.equal(running.task.status, "running");
    assert.equal(running.runs.length, 1);

    server.setTaskLog("dev", parent.id, "line1\nline2\n");
    const log = unwrap(await api.getTaskLog("dev", parent.id, { tail: 1 }));
    assert.equal(log.exists, true);
    assert.equal(log.content, "line2\n");
    assert.equal(log.truncated, true);
    assert.equal(
      server.lastRequest()?.path,
      `/deskrpg/kanban/tasks/${parent.id}/log?board=dev&tail=1`,
    );

    const orch = unwrap(await api.getOrchestration());
    assert.equal(orch.auto_decompose, false);
    const updated = unwrap(
      await api.updateOrchestration({ orchestrator_profile: "sophie", max_in_progress: 3 }),
    );
    assert.equal(updated.orchestrator_profile, "sophie");
    assert.equal(updated.resolved_orchestrator_profile, "sophie");
    assert.equal(updated.max_in_progress, 3);
    assert.equal(server.lastRequest()?.method, "PUT");

    const profiles = unwrap(await api.listProfiles());
    assert.deepEqual(
      profiles.profiles.map((p) => p.name),
      ["sophie"],
    );
  });

  it("첨부는 multipart 로 올리고 목록·조회·삭제한다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const { task } = unwrap(await api.createTask("dev", { title: "첨부" }));

    const uploaded = unwrap(
      await api.uploadAttachment("dev", task.id, { filename: "spec.md", content: "# 스펙" }),
    );
    assert.equal(uploaded.attachment.filename, "spec.md");
    assert.equal(uploaded.attachment.size, Buffer.byteLength("# 스펙"));
    assert.match(server.lastRequest()?.contentType ?? "", /^multipart\/form-data/);

    const listed = unwrap(await api.listAttachments("dev", task.id));
    assert.equal(listed.attachments.length, 1);

    const contentRes = await api.attachmentContent("dev", uploaded.attachment.id, {});
    assert.equal(contentRes.ok, true);
    if (contentRes.ok) assert.equal(await contentRes.response.text(), "# 스펙");
    assert.equal(
      server.lastRequest()?.path,
      `/deskrpg/kanban/attachments/${uploaded.attachment.id}?board=dev`,
    );

    unwrap(await api.deleteAttachment("dev", uploaded.attachment.id));
    assert.equal(unwrap(await api.listAttachments("dev", task.id)).attachments.length, 0);
  });
});

describe("kanban — 스웜", () => {
  function swarmBody() {
    return {
      goal: "목표",
      workers: [{ profile: "nova", title: "조사" }],
      verifier: "sophie",
      synthesizer: "dante",
    };
  }

  it("본문을 그대로 스웜 엔드포인트로 보내고 루트·워커·검증·합성 카드를 만든다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));

    const created = unwrap(await api.createSwarm("dev", swarmBody()));
    assert.equal(server.lastRequest()?.method, "POST");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/swarm?board=dev");
    assert.ok(created.root_id);
    assert.equal(created.worker_ids.length, 1);
    assert.ok(created.verifier_id);
    assert.ok(created.synthesizer_id);

    const board = unwrap(await api.getBoard("dev"));
    assert.equal(
      board.columns.reduce((n, c) => n + c.tasks.length, 0),
      4,
    );
  });

  it("goal 이 비면 400 invalid_field 다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const res = await api.createSwarm("dev", { ...swarmBody(), goal: "" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
  });

  it("워커가 0명이면 400 이다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const res = await api.createSwarm("dev", { ...swarmBody(), workers: [] });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
  });

  it("워커 title 이 비면 400 invalid_field 다 — kanban-routes.ts 검증을 우회해도 플러그인이 거절한다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const res = await api.createSwarm("dev", {
      ...swarmBody(),
      workers: [{ profile: "nova", title: "" }],
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
    assert.equal(res.failure.code, "invalid_field");
  });

  it("getBlackboard 는 스웜이 남긴 topology 를 돌려준다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const created = unwrap(await api.createSwarm("dev", swarmBody()));

    const bb = unwrap(await api.getBlackboard("dev", created.root_id));
    assert.equal(
      server.lastRequest()?.path,
      `/deskrpg/kanban/tasks/${created.root_id}/blackboard?board=dev`,
    );
    const topology = bb.blackboard.topology as { goal: string; root_id: string };
    assert.equal(topology.goal, "목표");
    assert.equal(topology.root_id, created.root_id);
  });

  it("모르는 카드의 블랙보드는 404 task_not_found 다", async () => {
    const api = owner().kanban;
    unwrap(await api.createBoard({ slug: "dev", name: "Dev" }));
    const res = await api.getBlackboard("dev", "no-such-task");
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 404);
    assert.equal(res.failure.code, "task_not_found");
  });
});

describe("events — 커서", () => {
  it("커서 없이 부르면 빈 목록 + 지금 토큰, 그 다음부터 새 이벤트를 준다", async () => {
    const client = owner();
    unwrap(await client.kanban.createBoard({ slug: "dev", name: "Dev" }));
    unwrap(await client.kanban.createTask("dev", { title: "이전" }));

    const first = unwrap(await client.events.poll({ board: "dev" }));
    assert.deepEqual(first.events, []);
    assert.ok(first.cursor);
    assert.equal(server.lastRequest()?.path, "/deskrpg/events?board=dev");

    const { task } = unwrap(await client.kanban.createTask("dev", { title: "이후" }));
    unwrap(await client.kanban.updateTask("dev", task.id, { status: "ready" }));

    const page = unwrap(await client.events.poll({ board: "dev", cursor: first.cursor }));
    assert.deepEqual(
      page.events.map((e) => e.kind),
      ["task.created", "task.status"],
    );
    assert.equal(page.events[1].task_id, task.id);
    assert.deepEqual(page.events[1].payload, {
      from: "todo",
      to: "ready",
      parent_count: 0,
      title: "이후",
      assignee: null,
    });
    assert.equal(page.has_more, false);
    assert.notEqual(page.cursor, first.cursor);

    const empty = unwrap(await client.events.poll({ board: "dev", cursor: page.cursor }));
    assert.deepEqual(empty.events, []);
  });

  it("limit 을 넘으면 has_more 가 참이고 이어서 받을 수 있다", async () => {
    const client = owner();
    const start = unwrap(await client.events.poll({}));
    server.pushEvent({ kind: "cron.run.started", profile: "sophie", payload: { job_id: "j1" } });
    server.pushEvent({ kind: "cron.run.finished", profile: "sophie", payload: { job_id: "j1" } });
    server.pushEvent({ kind: "cron.run.started", profile: "sophie", payload: { job_id: "j2" } });

    const p1 = unwrap(await client.events.poll({ cursor: start.cursor, limit: 2 }));
    assert.equal(p1.events.length, 2);
    assert.equal(p1.has_more, true);
    assert.equal(server.lastRequest()?.path, `/deskrpg/events?cursor=${start.cursor}&limit=2`);
    const p2 = unwrap(await client.events.poll({ cursor: p1.cursor, limit: 2 }));
    assert.equal(p2.events.length, 1);
    assert.equal(p2.has_more, false);
  });

  it("board 필터는 다른 보드 이벤트를 걸러낸다", async () => {
    const client = owner();
    const start = unwrap(await client.events.poll({ board: "a" }));
    server.pushEvent({ kind: "task.created", board: "a", task_id: "t1", payload: {} });
    server.pushEvent({ kind: "task.created", board: "b", task_id: "t2", payload: {} });
    const page = unwrap(await client.events.poll({ board: "a", cursor: start.cursor }));
    assert.deepEqual(
      page.events.map((e) => e.task_id),
      ["t1"],
    );
  });

  it("모르는 커서는 400 unknown_cursor 로 접힌다", async () => {
    const res = await owner().events.poll({ cursor: "nope" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
    assert.equal(res.failure.code, "unknown_cursor");
  });
});

describe("profile client — cron", () => {
  it("모든 크론 경로가 /p/sophie/ 프리픽스와 프로필 키를 쓴다", async () => {
    const api = sophie().cron;

    const created = unwrap(
      await api.createJob({ schedule: "every 30m", prompt: "정리해", name: "정리" }),
    );
    assert.equal(created.job.name, "정리");
    assert.equal(created.job.state, "scheduled");
    assert.equal(created.job.enabled, true);
    assert.equal(server.lastRequest()?.path, "/p/sophie/deskrpg/cron/jobs");
    assert.equal(server.lastRequest()?.auth, `Bearer ${SOPHIE}`);
    const id = created.job.id;

    const got = unwrap(await api.getJob(id));
    assert.equal(got.job.id, id);

    const updated = unwrap(await api.updateJob(id, { updates: { name: "새 이름", model: null } }));
    assert.equal(updated.job.name, "새 이름");
    assert.equal(updated.job.model, null);
    assert.equal(server.lastRequest()?.method, "PUT");

    const paused = unwrap(await api.pauseJob(id));
    assert.equal(paused.job.state, "paused");
    assert.equal(paused.job.enabled, false);
    const listedDefault = unwrap(await api.listJobs());
    assert.equal(listedDefault.jobs.length, 0, "비활성 잡은 include_disabled 없이는 안 보인다");
    const listedAll = unwrap(await api.listJobs({ includeDisabled: true }));
    assert.equal(listedAll.jobs.length, 1);
    assert.equal(server.lastRequest()?.path, "/p/sophie/deskrpg/cron/jobs?include_disabled=true");

    const resumed = unwrap(await api.resumeJob(id));
    assert.equal(resumed.job.state, "scheduled");

    const run = unwrap(await api.runJob(id));
    assert.deepEqual(run, { accepted: true });
    assert.equal(server.lastRequest()?.status, 202);

    const runs = unwrap(await api.listRuns(id, { limit: 5 }));
    assert.equal(runs.runs.length, 1);
    assert.equal(server.lastRequest()?.path, `/p/sophie/deskrpg/cron/jobs/${id}/runs?limit=5`);

    const deleted = unwrap(await api.deleteJob(id));
    assert.deepEqual(deleted, { ok: true });
    const gone = await api.getJob(id);
    assert.equal(gone.ok, false);
    if (gone.ok) return;
    assert.equal(gone.status, 404);
  });

  it("전달 대상·블루프린트·인스턴스화", async () => {
    const api = sophie().cron;
    server.setDeliveryTargets("sophie", [
      { id: "slack", name: "Slack", home_target_set: true, home_env_var: "SLACK_HOME" },
    ]);
    const targets = unwrap(await api.listDeliveryTargets());
    assert.equal(targets.targets[0].id, "slack");

    server.setBlueprints("sophie", [
      {
        key: "daily-digest",
        title: "일일 요약",
        description: "",
        category: "digest",
        tags: [],
        fields: [{ name: "time", type: "time", label: "시각", default: "09:00" }],
        command: "digest",
        appUrl: "/automations/daily-digest",
      },
    ]);
    const blueprints = unwrap(await api.listBlueprints());
    assert.equal(blueprints.blueprints[0].key, "daily-digest");

    const job = unwrap(
      await api.instantiateBlueprint({ blueprint: "daily-digest", values: { time: "10:00" } }),
    );
    assert.equal(job.job.name, "일일 요약");
    assert.equal(server.lastRequest()?.path, "/p/sophie/deskrpg/cron/blueprints/instantiate");

    const unknown = await api.instantiateBlueprint({ blueprint: "nope", values: {} });
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.status, 404);
  });

  it("크론 실행 이벤트가 통합 이벤트 스트림에 실린다", async () => {
    const start = unwrap(await owner().events.poll({}));
    const { job } = unwrap(
      await sophie().cron.createJob({ schedule: "every 1h", prompt: "p", name: "n" }),
    );
    unwrap(await sophie().cron.runJob(job.id));
    const page = unwrap(await owner().events.poll({ cursor: start.cursor }));
    assert.deepEqual(
      page.events.map((e) => e.kind),
      ["cron.run.started", "cron.run.finished"],
    );
    assert.equal(page.events[0].profile, "sophie");
    assert.equal(page.events[0].job_id, job.id);
    assert.equal(page.events[1].payload.status, "ok");
  });
});

describe("경로 인코딩", () => {
  it("프로필 이름·보드·id 를 URL 에 인코딩한다", async () => {
    const client = createProfilePluginClient({
      baseUrl: server.baseUrl,
      profileName: "a b",
      profileToken: "x",
    });
    await client.cron.getJob("j/1");
    assert.equal(server.lastRequest()?.path, "/p/a%20b/deskrpg/cron/jobs/j%2F1");

    await owner().kanban.getTask("b?x", "t&1");
    assert.equal(server.lastRequest()?.path, "/deskrpg/kanban/tasks/t%261?board=b%3Fx");
  });
});
