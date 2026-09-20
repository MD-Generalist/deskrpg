import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingOutcome } from "./meeting-outcome";
import {
  registerMeetingOutcome,
  type RegisterBatchInput,
  type RegisterMeetingDeps,
} from "./meeting-register";

const followUp = (title: string, after: number[] = [], assigneeNpcId: string | null = null) => ({
  title,
  summary: `${title} 요약`,
  acceptance: `${title} 완료 조건`,
  assigneeNpcId,
  assigneeName: null,
  after,
});

const outcome: MeetingOutcome = {
  decisions: ["A안 채택"],
  followUps: [followUp("조사", [], "npc-1"), followUp("초안", [0]), followUp("검토", [1])],
  project: { recommended: true, name: "가격 개편", reason: null },
};

const minutes = {
  id: "m1",
  channelId: "c1",
  topic: "가격 회의",
  initiatorId: "host",
  outcome,
};

type Recorded = {
  batches: RegisterBatchInput[];
  subprojects: Array<{ slug: string; name: string }>;
  saved: unknown[];
};

function deps(
  over: Partial<RegisterMeetingDeps> = {},
  ctx: { isChannelOwner: boolean; boardSlug: string } = { isChannelOwner: true, boardSlug: "b1" },
): RegisterMeetingDeps & Recorded {
  const rec: Recorded = { batches: [], subprojects: [], saved: [] };
  return {
    ...rec,
    loadMinutes: async () => minutes,
    loadChannelOwner: async () => "owner",
    resolveContext: async () => ({ ok: true, ctx }),
    ensureSubproject: async (_ctx, tenant) => {
      rec.subprojects.push(tenant);
    },
    createBatch: async (_ctx, input) => {
      rec.batches.push(input);
      return { ok: true, approvalId: "ap1", taskIds: input.items.map((_, i) => `t${i}`) };
    },
    saveRegistered: async (_id, registered) => {
      rec.saved.push(registered);
    },
    requesterForUser: (userId) => `user:${userId}`,
    now: () => "2026-09-21T00:00:00.000Z",
    ...over,
  };
}

const body = (
  items: Array<{ index: number; title?: string; npcId?: string | null; after?: number[] }>,
) => ({
  tenant: { slug: "가격-개편", name: "가격 개편" },
  items: items.map((item) => ({
    index: item.index,
    // 없는 번호를 시험할 때도 도우미가 먼저 터지지 않게 한다 — 검증은 등록 함수의 몫이다.
    title: item.title ?? outcome.followUps[item.index]?.title ?? "없는 항목",
    npcId: item.npcId ?? null,
    after: item.after ?? [],
  })),
});

test("선택한 후속 업무를 승인 묶음 하나로 넘기고, 끝나면 회의록에 연결을 남긴다", async () => {
  const d = deps();
  const result = await registerMeetingOutcome(
    {
      minutesId: "m1",
      userId: "host",
      body: body([
        { index: 0, npcId: "npc-1" },
        { index: 1, after: [0] },
      ]),
    },
    d,
  );

  assert.equal(result.ok, true);
  const batch = d.batches[0];
  assert.equal(batch.type, "task_execution");
  assert.deepEqual(batch.source, { kind: "meeting", id: "m1" });
  assert.equal(batch.requestedBy, "user:host");
  assert.equal(batch.title, "가격 회의");
  assert.deepEqual(
    batch.items.map((item) => [
      item.title,
      item.npcId,
      item.tenant,
      item.parents,
      item.idempotencyKey,
    ]),
    [
      ["조사", "npc-1", "가격-개편", [], "meeting:m1:0"],
      // after 는 회의 결과의 번호(0)이고, parents 는 **이 묶음 안의 자리**(0)다.
      ["초안", undefined, "가격-개편", [0], "meeting:m1:1"],
    ],
  );
  // 카드에서 회의 결정을 찾을 수 있어야 한다(D06 완료 조건).
  assert.match(batch.items[0].body ?? "", /조사 요약/);
  assert.match(batch.items[0].body ?? "", /조사 완료 조건/);
  assert.match(batch.items[0].body ?? "", /출처: 회의록 m1 — 가격 회의/);

  assert.deepEqual(d.saved, [
    {
      boardSlug: "b1",
      tenant: "가격-개편",
      taskIds: ["t0", "t1"],
      by: "host",
      at: "2026-09-21T00:00:00.000Z",
    },
  ]);
});

test("after 는 묶음 안의 자리로 다시 매긴다 — 0번을 빼고 1·2번만 등록해도 맞는다", async () => {
  const d = deps();
  await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 1 }, { index: 2, after: [1] }]) },
    d,
  );
  assert.deepEqual(
    d.batches[0].items.map((item) => item.parents),
    [[], [0]],
  );
});

test("주재자도 소유자도 아니면 403 이고 아무것도 만들지 않는다", async () => {
  const d = deps();
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "member", body: body([{ index: 0 }]) },
    d,
  );
  assert.deepEqual(result, { ok: false, status: 403, errorCode: "forbidden" });
  assert.equal(d.batches.length, 0);
});

test("이미 등록된 회의는 409", async () => {
  const registered = { boardSlug: "b1", tenant: null, taskIds: ["t"], by: "host", at: "x" };
  const d = deps({
    loadMinutes: async () => ({ ...minutes, outcome: { ...outcome, registered } }),
  });
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 0 }]) },
    d,
  );
  assert.deepEqual(result, { ok: false, status: 409, errorCode: "already_registered" });
});

test("회의 결과에 없는 번호·중복 번호·빈 목록·묶음 밖을 가리키는 after 는 400", async () => {
  const bad = [
    body([]),
    body([{ index: 9 }]),
    body([{ index: 0 }, { index: 0 }]),
    body([{ index: 1, after: [0] }]), // 0번은 이번에 등록하지 않는다
    { ...body([{ index: 0 }]), tenant: { slug: "Bad Slug", name: "x" } },
    { ...body([{ index: 0 }]), items: [{ index: 0, title: "   ", npcId: null, after: [] }] },
  ];
  for (const b of bad) {
    const d = deps();
    const result = await registerMeetingOutcome({ minutesId: "m1", userId: "host", body: b }, d);
    assert.equal(result.ok, false, JSON.stringify(b));
    // 관문 거절(`response`)이 아니라 본문 검증의 400 이어야 한다.
    assert.equal(!result.ok && "status" in result && result.status, 400, JSON.stringify(b));
    assert.equal(d.batches.length, 0);
  }
});

test("칸반 관문의 거절(게이트웨이 없음·플러그인 구버전·남의 보드)은 그대로 흘려보낸다", async () => {
  const response = { status: 428 } as unknown as Response;
  const d = deps({ resolveContext: async () => ({ ok: false, response }) });
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 0 }]) },
    d,
  );
  assert.deepEqual(result, { ok: false, response });
  assert.equal(d.batches.length, 0);
});

test("서브프로젝트 메타 행은 채널 소유자가 등록할 때만 만든다", async () => {
  const owner = deps({}, { isChannelOwner: true, boardSlug: "b1" });
  await registerMeetingOutcome(
    { minutesId: "m1", userId: "owner", body: body([{ index: 0 }]) },
    owner,
  );
  assert.deepEqual(owner.subprojects, [{ slug: "가격-개편", name: "가격 개편" }]);

  // 주재자는 등록은 하되 프로젝트 메타는 건드리지 않는다 — 그건 소유자만 바꾸는 표다.
  // 카드에는 테넌트가 그대로 붙고, 메타 없는 테넌트도 뷰에서 슬러그로 보인다.
  const host = deps({}, { isChannelOwner: false, boardSlug: "b1" });
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 0 }]) },
    host,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(host.subprojects, []);
  assert.equal(host.batches[0].items[0].tenant, "가격-개편");
});

test("서브프로젝트 없이도 등록된다", async () => {
  const d = deps();
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: { ...body([{ index: 0 }]), tenant: null } },
    d,
  );
  assert.equal(result.ok, true);
  assert.equal(d.batches[0].items[0].tenant, undefined);
  assert.deepEqual(d.subprojects, []);
});

test("일부만 만들어졌으면 등록 완료로 표시하지 않는다 — 버튼이 남고 재시도는 멱등이다", async () => {
  const d = deps({
    createBatch: async () => ({
      ok: true,
      approvalId: "ap1",
      taskIds: ["t0", null],
      failed: [{ index: 1, errorCode: "assignee_not_in_channel" }],
    }),
  });
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 0 }, { index: 1 }]) },
    d,
  );
  assert.deepEqual(result, {
    ok: false,
    status: 502,
    errorCode: "partially_registered",
    // 실패는 회의 결과의 번호로 돌려준다 — 화면이 어느 줄인지 짚을 수 있게.
    failed: [{ index: 1, errorCode: "assignee_not_in_channel" }],
  });
  assert.deepEqual(d.saved, []);
});

test("한 장도 못 만들었으면 그 사유를 돌려주고 아무것도 저장하지 않는다", async () => {
  const d = deps({ createBatch: async () => ({ ok: false, errorCode: "no_tasks_created" }) });
  const result = await registerMeetingOutcome(
    { minutesId: "m1", userId: "host", body: body([{ index: 0 }]) },
    d,
  );
  assert.deepEqual(result, { ok: false, status: 502, errorCode: "no_tasks_created" });
  assert.deepEqual(d.saved, []);
});
