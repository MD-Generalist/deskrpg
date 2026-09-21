// 승인 묶음 조회(isApprovalBatchCard)를 실제 DB 로 고정한다. 단위 테스트는 가짜 의존성을 쓰므로
// "승인 상태와 무관하게 묶음에 들었던 카드면 참" 이라는 성질은 여기서만 보인다.
import test from "node:test";
import assert from "node:assert/strict";

import { seedChannel, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

setupThrowawaySqlite("automation-approval-db");

async function seedApproval(channelId: string, status: string, taskIds: string[]) {
  const { db, approvals, approvalTargets } = await import("@/db");
  const [row] = await db
    .insert(approvals)
    .values({
      id: crypto.randomUUID(),
      channelId,
      type: "task_execution",
      status,
      requestedBy: "user:someone",
      title: `묶음 ${status}`,
      sourceJson: JSON.stringify({ kind: "meeting" }),
    })
    .returning({ id: approvals.id });
  await db
    .insert(approvalTargets)
    .values(taskIds.map((taskId) => ({ approvalId: row.id, taskId })));
}

test("승인 묶음에 들었던 카드면 승인 상태와 무관하게 참, 아니면 거짓, 다른 채널의 묶음은 보지 않는다", async () => {
  const owner = await seedUser("appr-db");
  const channel = await seedChannel(owner.id, "승인 채널");
  const other = await seedChannel(owner.id, "다른 채널");
  await seedApproval(channel.id, "pending", ["t-pending"]);
  await seedApproval(channel.id, "approved", ["t-approved"]);
  // 반려·수정 요청 묶음의 카드가 나중에 손으로 풀려 끝나도 사람이 목록으로 본 독립 업무다.
  await seedApproval(channel.id, "rejected", ["t-rejected"]);
  await seedApproval(channel.id, "revision_requested", ["t-revision"]);
  await seedApproval(other.id, "approved", ["t-elsewhere"]);

  const { createLiveIngestDeps } = await import("./automation-events");
  const deps = createLiveIngestDeps({ gatewayId: "g", boardSlug: "b" } as never);
  const ask = (taskId: string) => deps.isApprovalBatchCard!(channel.id, taskId);

  for (const id of ["t-pending", "t-approved", "t-rejected", "t-revision"]) {
    assert.equal(await ask(id), true, `${id} 는 묶음 카드다`);
  }
  assert.equal(await ask("swarm-child"), false);
  assert.equal(
    await ask("t-elsewhere"),
    false,
    "다른 채널의 묶음으로 이 채널 카드를 판정하지 않는다",
  );
});
