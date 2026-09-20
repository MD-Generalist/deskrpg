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
