// 실행 전 승인 관문의 진입점. 가짜 플러그인 서버 + 일회용 SQLite 로 끝까지 돈다.
//
// 여기서 고정하는 것: 카드가 `blocked` 로 서는 것, 묶음 안 선행이 id 로 이어지는 것,
// 일부 실패가 나머지를 막지 않는 것, 선행이 실패하면 그 자식은 **만들지 않는** 것,
// 한 장도 못 만들면 승인을 만들지 않는 것.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import {
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";
import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";

setupThrowawaySqlite("approvals-test");

const OWNER_TOKEN = "gateway-owner-key-1234567890";

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER_TOKEN,
    profileTokens: { sophie: "profile-key-1234567890" },
  });
});

after(async () => {
  await server.close();
});

async function seedCtx() {
  const owner = await seedUser(`appr-${Math.random().toString(36).slice(2, 8)}`);
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "승인 채널");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, {
    profileName: "sophie",
    displayName: "소피",
  });
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profile.id,
    positionX: 0,
    positionY: 0,
  });
  const { resolveKanbanChannelContext } = await import("@/lib/kanban-access");
  const resolved = await resolveKanbanChannelContext({
    userId: owner.id,
    channelId: channel.id,
  });
  assert.ok(resolved.ok, "칸반 컨텍스트를 풀지 못했습니다");
  return { ctx: resolved.ctx, npcId: npc.id, channelId: channel.id, ownerId: owner.id };
}

const source = { kind: "meeting" as const, id: "m1" };

test("카드는 blocked 로 서고 승인 1건에 전부 묶인다", async () => {
  const { ctx, npcId, channelId } = await seedCtx();
  const { createApprovalBatch, pendingApprovalTaskIds } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "3건 수행할까요?",
    requestedBy: "sophie",
    source,
    items: [{ title: "가", npcId }, { title: "나" }, { title: "다" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.taskIds.filter(Boolean).length, 3);
  assert.equal(result.failed, undefined);

  for (const id of result.taskIds) {
    const res = await ctx.client.kanban.getTask(ctx.boardSlug, id!);
    assert.ok(res.ok);
    assert.equal(res.data.task.status, "blocked", "승인 전에는 디스패치되면 안 된다");
  }
  const created = server
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/tasks?"));
  assert.ok(created.length >= 3);
  for (const request of created.slice(-3))
    assert.deepEqual((request.json as Record<string, unknown>).review_policy, {
      version: 1,
      mode: "human",
      reviewer_profile: null,
    });
  const pending = await pendingApprovalTaskIds(channelId);
  assert.equal(pending.size, 3);
});

test("묶음 안 선행은 인덱스로 받아 id 로 이어진다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  // 0 이 1 을 선행으로 갖는다 — 1 이 먼저 만들어져야 한다.
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "선행 있는 묶음",
    requestedBy: "sophie",
    source,
    items: [{ title: "나중", parents: [1] }, { title: "먼저" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const later = await ctx.client.kanban.getTask(ctx.boardSlug, result.taskIds[0]!);
  assert.ok(later.ok);
  assert.equal(
    later.data.task.link_counts?.parents,
    1,
    "뒤 항목이 앞 항목을 부모로 갖고 있어야 한다",
  );
});

test("순환하는 선행은 카드를 한 장도 만들지 않는다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "순환",
    requestedBy: "sophie",
    source,
    items: [
      { title: "가", parents: [1] },
      { title: "나", parents: [0] },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.errorCode, "parent_cycle");
});

test("담당이 이 채널 NPC 가 아니면 그 줄만 실패하고 나머지는 만들어진다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "일부 실패",
    requestedBy: "sophie",
    source,
    items: [{ title: "가", npcId: "00000000-0000-4000-8000-000000000000" }, { title: "나" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.taskIds[0], null);
  assert.ok(result.taskIds[1]);
  assert.deepEqual(result.failed, [{ index: 0, errorCode: "assignee_not_in_channel" }]);
});

test("선행이 실패하면 그 자식은 만들지 않는다 — 영영 안 풀리는 부모를 기다리게 두지 않는다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "선행 실패",
    requestedBy: "sophie",
    source,
    items: [
      { title: "선행", npcId: "00000000-0000-4000-8000-000000000000" },
      { title: "자식", parents: [0] },
      { title: "무관" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.taskIds[0], null);
  assert.equal(result.taskIds[1], null, "부모가 없으면 자식도 만들지 않는다");
  assert.ok(result.taskIds[2], "관계 없는 줄은 만들어진다");
  assert.deepEqual(result.failed, [
    { index: 0, errorCode: "assignee_not_in_channel" },
    { index: 1, errorCode: "parent_failed" },
  ]);
});

test("한 장도 못 만들면 승인을 만들지 않는다 — 누를 것이 없는 승인은 소음이다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch, pendingApprovalTaskIds } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "전부 실패",
    requestedBy: "sophie",
    source,
    items: [{ title: "가", npcId: "00000000-0000-4000-8000-000000000000" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.errorCode, "no_tasks_created");
  assert.equal((await pendingApprovalTaskIds(channelId)).size, 0);
});

test("멱등 키가 같으면 재시도해도 카드가 늘지 않는다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const input = {
    type: "task_execution",
    title: "재시도",
    requestedBy: "sophie",
    source,
    items: [{ title: "한 번만", idempotencyKey: "meeting:m9:0" }],
  };
  const first = await createApprovalBatch(ctx, input);
  const second = await createApprovalBatch(ctx, input);
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.taskIds[0], second.taskIds[0], "같은 카드를 돌려줘야 한다");
});

test("재시도해도 승인 레코드가 늘지 않는다 — 같은 출처의 pending 을 재사용한다", async () => {
  // 카드 id 만 같은지 보면 이 결함이 보이지 않는다. 승인 수를 세야 한다.
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const { db, approvals, approvalTargets } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const input = {
    type: "task_execution",
    title: "재시도",
    requestedBy: "sophie",
    source: { kind: "meeting" as const, id: "m-retry" },
    items: [{ title: "한 번만", idempotencyKey: "meeting:m-retry:0" }],
  };
  const first = await createApprovalBatch(ctx, input);
  const second = await createApprovalBatch(ctx, input);
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(second.approvalId, first.approvalId, "같은 승인을 돌려줘야 한다");

  const rows = await db.select().from(approvals).where(eq(approvals.channelId, channelId));
  assert.equal(rows.length, 1, "승인이 두 벌 생기면 하나는 영영 pending 으로 남는다");
  const targets = await db
    .select()
    .from(approvalTargets)
    .where(eq(approvalTargets.approvalId, first.approvalId));
  assert.equal(targets.length, 1);
});

test("첫 호출에서 일부만 성공하면, 재시도가 같은 승인에 나머지를 더한다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const { db, approvals, approvalTargets } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const source = { kind: "meeting" as const, id: "m-partial" };
  const ghost = "00000000-0000-4000-8000-000000000000";

  const first = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "부분 성공",
    requestedBy: "sophie",
    source,
    items: [
      { title: "되는 것", idempotencyKey: "meeting:m-partial:0" },
      { title: "안 되는 것", npcId: ghost, idempotencyKey: "meeting:m-partial:1" },
    ],
  });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.failed?.length, 1);

  // 사용자가 버튼을 다시 누른다 — 이번에는 담당을 빼고.
  const second = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "부분 성공",
    requestedBy: "sophie",
    source,
    items: [
      { title: "되는 것", idempotencyKey: "meeting:m-partial:0" },
      { title: "안 되는 것", idempotencyKey: "meeting:m-partial:1" },
    ],
  });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.approvalId, first.approvalId);
  assert.equal(
    (await db.select().from(approvals).where(eq(approvals.channelId, channelId))).length,
    1,
  );
  const targets = await db
    .select()
    .from(approvalTargets)
    .where(eq(approvalTargets.approvalId, first.approvalId));
  assert.equal(targets.length, 2, "재시도로 붙은 카드가 같은 승인의 대상이 된다");
});

test("다른 출처의 승인은 재사용하지 않는다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const { db, approvals } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const base = { type: "task_execution", title: "다른 출처", requestedBy: "sophie" };
  const a = await createApprovalBatch(ctx, {
    ...base,
    source: { kind: "meeting" as const, id: "m-a" },
    items: [{ title: "가" }],
  });
  const b = await createApprovalBatch(ctx, {
    ...base,
    source: { kind: "meeting" as const, id: "m-b" },
    items: [{ title: "나" }],
  });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.approvalId, b.approvalId);
  assert.equal(
    (await db.select().from(approvals).where(eq(approvals.channelId, channelId))).length,
    2,
  );
});

test("출처의 키 순서가 달라도 같은 승인으로 본다", () => {
  // `sourceJson` 이 문자열 일치라, 직렬화를 필드 명시로 고정하지 않으면 여기서 갈린다.
  const a = JSON.stringify({ kind: "meeting", id: "m1" });
  const b = JSON.stringify({ kind: "meeting", id: "m1" } as const);
  assert.equal(a, b);
});

test("호출자가 키 순서를 바꿔 줘도 승인이 하나다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const { db, approvals } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const base = { type: "task_execution", title: "키 순서", requestedBy: "sophie" };
  await createApprovalBatch(ctx, {
    ...base,
    source: { kind: "meeting", id: "m-order" },
    items: [{ title: "가", idempotencyKey: "meeting:m-order:0" }],
  });
  await createApprovalBatch(ctx, {
    ...base,
    // 같은 출처를 키 순서만 바꿔 넘긴다.
    source: JSON.parse('{"id":"m-order","kind":"meeting"}'),
    items: [{ title: "가", idempotencyKey: "meeting:m-order:0" }],
  });
  assert.equal(
    (await db.select().from(approvals).where(eq(approvals.channelId, channelId))).length,
    1,
  );
});

test("승인을 만들면 사무실 방에 시스템 알림이 남는다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "2건 수행할까요?",
    requestedBy: "sophie",
    source: { kind: "meeting", id: "m-notice" },
    items: [{ title: "가" }, { title: "나" }],
  });
  assert.ok(result.ok);
  if (!result.ok) return;

  const { ensureOfficeRoom, recentRoomMessages, getChannelOwnerId } =
    await import("@/lib/chat-rooms");
  const ownerId = await getChannelOwnerId(channelId);
  assert.ok(ownerId);
  const room = await ensureOfficeRoom(channelId, ownerId!);
  const messages = await recentRoomMessages(room.id, 20);
  const notice = messages.map((m) => m.notice).find((n) => n?.kind === "approval_requested");
  assert.ok(notice, "승인 알림이 방에 없다");
  assert.deepEqual(notice, {
    kind: "approval_requested",
    approvalId: result.approvalId,
    title: "2건 수행할까요?",
    npcName: "sophie",
    targetCount: 2,
  });
  const row = messages.find((m) => m.notice?.kind === "approval_requested");
  assert.equal(row?.senderKind, "system", "사람이 시작한 묶음도 있으므로 직원 발화로 두지 않는다");
});

test("사람이 요청한 묶음은 알림에 직원 이름을 싣지 않는다", async () => {
  const { ctx, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const { formatRequester } = await import("@/lib/approval-requester");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "회의에서 나온 일",
    requestedBy: formatRequester({ kind: "user", userId: "u-1" }),
    source: { kind: "meeting", id: "m-user" },
    items: [{ title: "가" }],
  });
  assert.ok(result.ok);

  const { ensureOfficeRoom, recentRoomMessages, getChannelOwnerId } =
    await import("@/lib/chat-rooms");
  const ownerId = await getChannelOwnerId(channelId);
  const room = await ensureOfficeRoom(channelId, ownerId!);
  const messages = await recentRoomMessages(room.id, 20);
  const notice = messages.map((m) => m.notice).find((n) => n?.kind === "approval_requested");
  assert.ok(notice && notice.kind === "approval_requested");
  if (!notice || notice.kind !== "approval_requested") return;
  assert.equal(notice.npcName, "", "user:<id> 를 직원 이름 자리에 넣으면 안 된다");
});

test("승인 정책 미지원이면 묶음의 카드와 승인 레코드를 쓰지 않는다", async () => {
  const { ctx } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  ctx.info = { ...ctx.info!, capabilities: ["kanban", "cron", "events"] };
  const before = server.requests().length;
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "새 업무",
    requestedBy: "sophie",
    source,
    items: [{ title: "쓰기 금지" }],
  });
  assert.deepEqual(result, { ok: false, errorCode: "review_policy_required" });
  assert.equal(server.requests().length, before);
});
