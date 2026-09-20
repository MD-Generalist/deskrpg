// 해소 도메인 로직 — 순서·한 번만·실패는 되돌린다.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ProposalStepError,
  resolveProposal,
  type CardProposalNotice,
  type ProposalAssigneeResult,
  type ProposalRecord,
  type ProposalTaskInput,
  type ResolveDeps,
} from "./card-proposals";

type Ctx = { channelId: string };

const NOTICE: CardProposalNotice = {
  kind: "card_proposal",
  proposalId: "p1",
  title: "청구서 정리",
  summary: "8월 청구서를 모아 달라",
  body: "본문",
  acceptance: "표로 정리",
  npcId: "npc-1",
  npcName: "노아",
};

type Stub = ResolveDeps<Ctx> & {
  createTaskCalls: number;
  noticeUpdates: number;
  rollbacks: number;
  tasks: ProposalTaskInput[];
  order: string[];
  resolvedWrites: NonNullable<CardProposalNotice["resolved"]>[];
};

function gateError(status: number, code: string): ProposalStepError {
  return new ProposalStepError(status, code);
}

function stubDeps(over: {
  gate?: ResolveDeps<Ctx>["gate"];
  proposal?: ProposalRecord | null;
  markResolved?: () => Promise<boolean>;
  unresolve?: () => Promise<void>;
  assignee?: ProposalAssigneeResult;
  createTask?: () => Promise<{ task: { id: string } }>;
  writeResolved?: () => Promise<void>;
}): Stub {
  const stub: Stub = {
    createTaskCalls: 0,
    noticeUpdates: 0,
    rollbacks: 0,
    tasks: [],
    order: [],
    resolvedWrites: [],
    now: () => new Date("2026-09-21T00:00:00.000Z"),
    gate:
      over.gate ??
      (async ({ channelId }) => {
        stub.order.push("gate");
        return { ok: true, ctx: { channelId } };
      }),
    loadProposal: async () => {
      stub.order.push("loadProposal");
      return over.proposal === undefined ? { messageId: "m1", notice: NOTICE } : over.proposal;
    },
    markResolved: async () => {
      stub.order.push("markResolved");
      return over.markResolved ? await over.markResolved() : true;
    },
    unresolve: async () => {
      stub.rollbacks += 1;
      stub.order.push("unresolve");
      if (over.unresolve) await over.unresolve();
    },
    resolveAssignee: async () => {
      stub.order.push("resolveAssignee");
      return over.assignee ?? { ok: true, profileName: "noah" };
    },
    createTask: async ({ task }) => {
      stub.createTaskCalls += 1;
      stub.tasks.push(task);
      stub.order.push("createTask");
      if (over.createTask) return await over.createTask();
      return { task: { id: "t1" } };
    },
    writeResolved: async ({ resolved }) => {
      stub.noticeUpdates += 1;
      stub.order.push("writeResolved");
      stub.resolvedWrites.push(resolved);
      if (over.writeResolved) await over.writeResolved();
    },
  };
  return stub;
}

const CARD = { channelId: "c1", userId: "u1", proposalId: "p1", choice: "card" } as const;

test("card 선택은 카드를 만들고 taskId 를 돌려준다", async () => {
  const deps = stubDeps({ createTask: async () => ({ task: { id: "t1" } }) });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: true, choice: "card", taskId: "t1", assigneeDropped: false });
  assert.deepEqual(deps.tasks, [
    { title: "청구서 정리", body: "본문", acceptance: "표로 정리", assignee: "noah" },
  ]);
  assert.deepEqual(deps.resolvedWrites, [
    { choice: "card", by: "u1", at: "2026-09-21T00:00:00.000Z", taskId: "t1" },
  ]);
  // 관문 → 해소 표시 → 담당 → 카드 → 알림. 이 순서가 규칙이다.
  assert.deepEqual(deps.order, [
    "gate",
    "loadProposal",
    "markResolved",
    "resolveAssignee",
    "createTask",
    "writeResolved",
  ]);
});

test("이미 해소된 제안은 409 이고 카드를 만들지 않는다", async () => {
  const deps = stubDeps({ markResolved: async () => false });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: false, status: 409, code: "already_resolved" });
  assert.equal(deps.createTaskCalls, 0);
  assert.equal(deps.noticeUpdates, 0);
});

test("카드 생성 실패는 해소를 기록하지 않는다", async () => {
  const deps = stubDeps({
    createTask: async () => {
      throw gateError(428, "plugin_required");
    },
  });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, {
    ok: false,
    status: 428,
    code: "plugin_required",
    message: "plugin_required",
  });
  assert.equal(deps.noticeUpdates, 0); // notice_json.resolved 가 쓰이지 않았다
  assert.equal(deps.rollbacks, 1); // 플러그인 쪽 해소 표시도 되돌렸다
});

test("되돌리기가 실패하면 그 사실을 오류에 담아 올린다", async () => {
  const deps = stubDeps({
    createTask: async () => {
      throw gateError(503, "board_unavailable");
    },
    unresolve: async () => {
      throw new Error("gateway offline");
    },
  });
  const out = await resolveProposal(CARD, deps);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.status, 500);
  assert.equal(out.ok === false && out.code, "resolve_rollback_failed");
  const message = out.ok === false ? (out.message ?? "") : "";
  assert.match(message, /board_unavailable/);
  assert.match(message, /gateway offline/);
  assert.equal(deps.noticeUpdates, 0);
});

test("담당이 퇴근했으면 담당 없이 만들고 그 사실을 알린다", async () => {
  const deps = stubDeps({
    assignee: { ok: false, code: "assignee_not_in_channel" },
    createTask: async () => ({ task: { id: "t1" } }),
  });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: true, choice: "card", taskId: "t1", assigneeDropped: true });
  assert.deepEqual(deps.tasks, [{ title: "청구서 정리", body: "본문", acceptance: "표로 정리" }]);
});

test("inline 선택은 카드를 만들지 않는다", async () => {
  const deps = stubDeps({});
  const out = await resolveProposal({ ...CARD, choice: "inline" }, deps);
  assert.deepEqual(out, { ok: true, choice: "inline" });
  assert.equal(deps.createTaskCalls, 0);
  assert.deepEqual(deps.order, ["gate", "loadProposal", "markResolved", "writeResolved"]);
  assert.deepEqual(deps.resolvedWrites, [
    { choice: "inline", by: "u1", at: "2026-09-21T00:00:00.000Z" },
  ]);
});

test("관문이 막으면 플러그인을 건드리지 않는다", async () => {
  const deps = stubDeps({
    gate: async () => ({ ok: false, status: 409, code: "gateway_not_bound" }),
  });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: false, status: 409, code: "gateway_not_bound" });
  assert.deepEqual(deps.order, []);
  assert.equal(deps.createTaskCalls, 0);
});

test("없는 제안은 404 이고 해소를 표시하지 않는다", async () => {
  const deps = stubDeps({ proposal: null });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: false, status: 404, code: "card_proposal_not_found" });
  assert.deepEqual(deps.order, ["gate", "loadProposal"]);
});

test("이미 resolved 가 남은 알림은 플러그인을 부르기 전에 409", async () => {
  const deps = stubDeps({
    proposal: {
      messageId: "m1",
      notice: {
        ...NOTICE,
        resolved: { choice: "card", by: "u1", at: "2026-09-20T00:00:00.000Z", taskId: "t0" },
      },
    },
  });
  const out = await resolveProposal(CARD, deps);
  assert.deepEqual(out, { ok: false, status: 409, code: "already_resolved" });
  assert.deepEqual(deps.order, ["gate", "loadProposal"]);
});

test("알림 쓰기 실패는 카드가 만들어졌다는 사실을 오류에 남긴다", async () => {
  const deps = stubDeps({
    writeResolved: async () => {
      throw new Error("db down");
    },
  });
  const out = await resolveProposal(CARD, deps);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.code, "notice_write_failed");
  assert.match(out.ok === false ? (out.message ?? "") : "", /t1/);
  assert.equal(deps.rollbacks, 0); // 카드는 Hermes 에 있다 — 되돌리지 않는다
});
