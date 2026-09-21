// 승인 결정 REST 의 몸통. 가짜 플러그인 서버 + 일회용 SQLite 로 끝까지 돈다.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";
import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";

setupThrowawaySqlite("approval-routes-test");

let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: { sophie: "profile-key-1234567890" },
  });
});
after(async () => {
  await server.close();
});

async function seedCtx() {
  const owner = await seedUser(`dec-${Math.random().toString(36).slice(2, 8)}`);
  const gateway = await seedGateway(owner.id, server.baseUrl);
  const channel = await seedChannel(owner.id, "결정 채널");
  const { bindGatewayToChannel } = await import("@/lib/gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  const profile = await seedHermesProfile(gateway.id, { profileName: "sophie" });
  await seedNpc({ channelId: channel.id, hermesProfileId: profile.id, positionX: 0, positionY: 0 });
  const { resolveKanbanChannelContext } = await import("@/lib/kanban-access");
  const resolved = await resolveKanbanChannelContext({ userId: owner.id, channelId: channel.id });
  assert.ok(resolved.ok);
  return { ctx: resolved.ctx, ownerId: owner.id, channelId: channel.id };
}

async function makeApproval(ctx: Awaited<ReturnType<typeof seedCtx>>["ctx"], titles: string[]) {
  const { createApprovalBatch } = await import("@/lib/approvals");
  const result = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: `${titles.length}건 수행할까요?`,
    requestedBy: "sophie",
    source: { kind: "meeting", id: `m-${Math.random().toString(36).slice(2, 8)}` },
    items: titles.map((title) => ({ title })),
  });
  assert.ok(result.ok);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function post(userId: string, channelId: string, approvalId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/channels/${channelId}/approvals/${approvalId}/decide`,
    { method: "POST", headers: authHeaders(userId), body: JSON.stringify(body) },
  );
}

test("승인하면 대상 카드가 전부 풀린다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가", "나"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "approve" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "approved");
  assert.equal(body.unblocked.length, 2);
  for (const id of batch.taskIds) {
    const task = await ctx.client.kanban.getTask(ctx.boardSlug, id!);
    assert.ok(task.ok);
    assert.notEqual(task.data.task.status, "blocked", "승인했으면 더 이상 막혀 있으면 안 된다");
  }
});

test("결정하면 방의 승인 요청 줄이 결과를 말한다 — 버튼이 남지 않는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "approve" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 200);

  const { ensureOfficeRoom, recentRoomMessages } = await import("@/lib/chat-rooms");
  const room = await ensureOfficeRoom(channelId, ownerId);
  const notice = (await recentRoomMessages(room.id, 20))
    .map((m) => m.notice)
    .find((n) => n?.kind === "approval_requested" && n.approvalId === batch.approvalId);
  assert.ok(notice && notice.kind === "approval_requested");
  if (!notice || notice.kind !== "approval_requested") return;
  assert.equal(notice.resolved?.decision, "approved");
  assert.equal(notice.resolved?.by, ownerId);
});

test("반려하면 아무것도 풀리지 않고 카드는 blocked 로 남는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "reject", note: "범위가 넓습니다" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).unblocked, []);
  const task = await ctx.client.kanban.getTask(ctx.boardSlug, batch.taskIds[0]!);
  assert.ok(task.ok);
  assert.equal(task.data.task.status, "blocked", "단테 결정: 반려해도 카드는 남는다");
});

test("두 번째 결정은 409 — 두 탭에서 눌러도 한쪽만 이긴다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const first = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "approve" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(first.status, 200);
  const second = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "reject" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "approval_already_decided");
});

test("다른 채널의 승인 id 는 404 — 존재 여부가 새지 않는다", async () => {
  const a = await seedCtx();
  const b = await seedCtx();
  const batch = await makeApproval(a.ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(b.ownerId, b.channelId, batch.approvalId, { decision: "approve" }),
    b.channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "approval_not_found");
});

test("로그인하지 않으면 401", async () => {
  const { ctx, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const req = new NextRequest(`http://localhost/x`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });
  const res = await decideApproval(req, channelId, batch.approvalId);
  assert.equal(res.status, 401);
});

test("결정 값이 틀리면 400 이고 승인은 그대로 pending 이다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "unblock" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "invalid_decision");

  const { pendingApprovalTaskIds } = await import("@/lib/approvals");
  assert.equal(
    (await pendingApprovalTaskIds(channelId)).size,
    1,
    "거절된 요청이 상태를 바꾸면 안 된다",
  );
});

test("이 승인 밖의 카드를 지정하면 400 이고 아무것도 풀리지 않는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, {
      decision: "approve",
      targets: [{ task_id: "ghost", decision: "approve" }],
    }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "target_not_in_approval");
  const task = await ctx.client.kanban.getTask(ctx.boardSlug, batch.taskIds[0]!);
  assert.ok(task.ok);
  assert.equal(task.data.task.status, "blocked");
});

test("부분 반려는 그 카드만 막고 나머지는 푼다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가", "나"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, {
      decision: "approve",
      targets: [{ task_id: batch.taskIds[0]!, decision: "reject" }],
    }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).unblocked, [batch.taskIds[1]]);
  const blocked = await ctx.client.kanban.getTask(ctx.boardSlug, batch.taskIds[0]!);
  assert.ok(blocked.ok);
  assert.equal(blocked.data.task.status, "blocked");
});

test("수정 요청은 아무것도 풀지 않고 메모를 카드 댓글로 남긴다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, {
      decision: "request_revision",
      note: "완료 조건을 적어 주세요",
    }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "revision_requested");
  const task = await ctx.client.kanban.getTask(ctx.boardSlug, batch.taskIds[0]!);
  assert.ok(task.ok);
  assert.equal(task.data.task.status, "blocked");
  assert.equal(task.data.comments?.length, 1, "고쳐 달라는 말이 카드에 남아야 직원이 읽는다");
});

test("메모가 없으면 댓글을 남기지 않는다 — 빈 댓글은 소음이다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "reject" }),
    channelId,
    batch.approvalId,
  );
  const task = await ctx.client.kanban.getTask(ctx.boardSlug, batch.taskIds[0]!);
  assert.ok(task.ok);
  assert.equal(task.data.comments?.length ?? 0, 0);
});

test("항목별 결정 값이 모르는 것이면 400 — DB 에 쓰이기 전에 막는다", async () => {
  // `decideTargets` 는 모르는 값에 카드를 풀지 않아 fail-closed 지만, 그 값이
  // `approval_targets.decision` 에 실릴 수 있다. 경계에서 거른다.
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, {
      decision: "approve",
      targets: [{ task_id: batch.taskIds[0]!, decision: "maybe" }],
    }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "invalid_targets");

  const { db, approvalTargets } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(approvalTargets)
    .where(eq(approvalTargets.approvalId, batch.approvalId));
  assert.equal(rows[0].decision, null, "거절된 요청이 항목 결정을 쓰면 안 된다");
});

/** 둘째 보드를 만들고 그 슬러그를 돌려준다 — 다중 보드는 이미 출시본에 있다. */
async function makeSecondBoard(ownerId: string, channelId: string): Promise<string> {
  const routes = await import(`@/app/api/channels/[id]/projects/route`);
  const res = await routes.POST(
    new NextRequest(`http://localhost/api/channels/${channelId}/projects`, {
      method: "POST",
      headers: { ...authHeaders(ownerId), "content-type": "application/json" },
      body: JSON.stringify({ name: "둘째 프로젝트" }),
    }),
    { params: Promise.resolve({ id: channelId }) } as never,
  );
  const body = (await res.json()) as { project?: { boardSlug: string }; code?: string };
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.project!.boardSlug;
}

test("기본 보드가 아닌 곳의 카드도 승인하면 풀린다", async () => {
  // 예전에는 결정이 늘 채널 기본 보드로 `unblock` 을 보내, 카드가 다른 보드에 있으면
  // 전부 task_not_found 로 실패하는데 승인은 이미 닫혀 있었다 — 승인했는데 아무 일도
  // 일어나지 않는 상태다.
  const { ctx, ownerId, channelId } = await seedCtx();
  const second = await makeSecondBoard(ownerId, channelId);
  assert.notEqual(second, ctx.boardSlug, "둘째 보드가 기본 보드와 같으면 이 시험이 무의미하다");

  const { createApprovalBatch } = await import("@/lib/approvals");
  const batch = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "둘째 보드의 일",
    requestedBy: "sophie",
    source: { kind: "meeting", id: "m-board" },
    boardSlug: second,
    items: [{ title: "가" }],
  });
  assert.ok(batch.ok);
  if (!batch.ok) return;

  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "approve" }),
    channelId,
    batch.approvalId,
  );
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.failed, undefined, "그 보드로 갔으면 실패가 없어야 한다");
  assert.deepEqual(body.unblocked, batch.taskIds);

  const task = await ctx.client.kanban.getTask(second, batch.taskIds[0]!);
  assert.ok(task.ok);
  assert.notEqual(task.data.task.status, "blocked");
});

test("풀기가 전부 실패하면 승인을 되돌리고 502 — 다시 누를 수 있게", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const { createApprovalBatch } = await import("@/lib/approvals");
  const batch = await createApprovalBatch(ctx, {
    type: "task_execution",
    title: "게이트웨이가 안 닿는 순간",
    requestedBy: "sophie",
    source: { kind: "meeting", id: "m-down" },
    items: [{ title: "가" }, { title: "나" }],
  });
  assert.ok(batch.ok);
  if (!batch.ok) return;

  // unblock 두 번을 모두 실패시킨다.
  server.failNext("/deskrpg/kanban/tasks", 2);

  const { decideApproval } = await import("@/lib/approval-routes");
  const res = await decideApproval(
    post(ownerId, channelId, batch.approvalId, { decision: "approve" }),
    channelId,
    batch.approvalId,
  );
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "unblock_failed");

  const { pendingApprovalTaskIds } = await import("@/lib/approvals");
  assert.equal(
    (await pendingApprovalTaskIds(channelId)).size,
    2,
    "되돌리지 않으면 다시 누를 pending 이 없어 사용자가 카드를 손으로 풀어야 한다",
  );
});

// 승인으로 카드를 풀면 디스패치를 한 번 요청한다. 카드 액션 라우트는 unblock 뒤 디스패치를
// 부르는데, 승인 결정은 unblock 을 직접 보내 그 규칙을 비껴갔다 — 그 뒤는 게이트웨이 내장
// 디스패처의 주기에 맡겨져, 스테이징에서 카드가 ready 에 약 5분 머물렀다.
function dispatchCount() {
  return server
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/deskrpg/kanban/dispatch")).length;
}

async function decide(approvalId: string, ownerId: string, channelId: string, body: unknown) {
  const { decideApproval } = await import("@/lib/approval-routes");
  return decideApproval(post(ownerId, channelId, approvalId, body), channelId, approvalId);
}

test("승인으로 카드를 풀면 디스패치를 한 번 요청한다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가", "나"]);
  const before = dispatchCount();
  const res = await decide(batch.approvalId, ownerId, channelId, { decision: "approve" });
  assert.equal(res.status, 200);
  assert.equal(dispatchCount() - before, 1, "카드 두 장이어도 디스패치는 한 번이다");
});

test("반려·수정 요청은 아무것도 풀지 않으므로 디스패치하지 않는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  for (const decision of ["reject", "request_revision"]) {
    const batch = await makeApproval(ctx, [`${decision}-가`]);
    const before = dispatchCount();
    await decide(batch.approvalId, ownerId, channelId, { decision });
    assert.equal(dispatchCount() - before, 0, `${decision} 뒤에 디스패치가 나갔다`);
  }
});

test("풀기가 전부 실패하면 디스패치하지 않는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  server.failNext("/deskrpg/kanban/tasks", 1);
  const before = dispatchCount();
  const res = await decide(batch.approvalId, ownerId, channelId, { decision: "approve" });
  assert.equal(res.status, 502);
  assert.equal(dispatchCount() - before, 0);
});

test("디스패치가 실패해도 승인은 성공이다 — 내장 디스패처가 이어받는다", async () => {
  const { ctx, ownerId, channelId } = await seedCtx();
  const batch = await makeApproval(ctx, ["가"]);
  server.failNext("/deskrpg/kanban/dispatch", 1);
  const res = await decide(batch.approvalId, ownerId, channelId, { decision: "approve" });
  assert.equal(res.status, 200);
});
