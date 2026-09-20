/**
 * 승인 결정 REST 의 몸통. 라우트 파일은 얇게 두고 순서를 여기 한 곳에 고정한다
 * (`src/app/api/AGENTS.md`).
 *
 * 관문 순서는 칸반과 같다 — `resolveKanbanChannelContext` 가 로그인 → 멤버 →
 * 게이트웨이 409 → 플러그인 428 → 보드 소속 404 → 보드 503 을 보장한다. 여기서
 * 우회 경로를 만들지 않는다.
 *
 * 승인은 **카드 상태로** 직원에게 전달된다. `unblock` 이 되면 디스패처가 집어 가므로
 * 별도 통지 경로가 없다 — 이 설계가 새 채널을 만들지 않아도 되는 이유다.
 */
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { approvalTargets, approvals, db, nowForDb } from "@/db";
import { approvalTargetIds } from "@/lib/approvals";
import {
  decideTargets,
  nextApprovalStatus,
  parseDecision,
  type TargetDecision,
} from "@/lib/approval-decision";
import { cronError } from "@/lib/cron-access";
import { initialStatusGate } from "@/lib/hermes/plugin-capability";
import { pluginUpgradeRequired } from "@/lib/hermes/plugin-errors";
import { getUserId } from "@/lib/internal-rpc";
import { resolveKanbanChannelContext } from "@/lib/kanban-access";

export type ApprovalParams = { params: Promise<{ id: string; approvalId: string }> };

function readTargets(raw: unknown): TargetDecision[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out: TargetDecision[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const taskId = (entry as { task_id?: unknown }).task_id;
    const decision = parseDecision((entry as { decision?: unknown }).decision);
    if (typeof taskId !== "string" || !taskId || !decision) return null;
    out.push({ taskId, decision });
  }
  return out;
}

/** POST — 승인 하나를 결정하고, 승인된 카드를 `unblock` 한다. */
export async function decideApproval(req: NextRequest, channelId: string, approvalId: string) {
  const resolved = await resolveKanbanChannelContext({
    userId: getUserId(req),
    channelId,
  });
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  // 관문을 켤 수 있는 플러그인인가. 없는 채로 결정만 기록하면 카드는 영영 blocked 로 남는다.
  const gate = initialStatusGate(ctx.info);
  if (!gate.ok) {
    const failure = pluginUpgradeRequired(gate);
    return cronError(428, failure.code, failure.message, failure.details);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  const decision = parseDecision(body.decision);
  if (!decision)
    return cronError(400, "invalid_decision", "decision must be approve|reject|request_revision");
  const targets = readTargets(body.targets);
  if (targets === null)
    return cronError(400, "invalid_targets", "targets must be [{task_id, decision}]");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  // 이 채널의 승인만. 남의 채널 승인 id 를 넣어도 존재 여부가 새지 않게 404 로 접는다.
  const [row] = await db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.channelId, channelId)))
    .limit(1);
  if (!row) return cronError(404, "approval_not_found", "approval not found");
  if (row.status !== "pending")
    return cronError(409, "approval_already_decided", "approval already decided");

  const targetIds = await approvalTargetIds(approvalId);
  const plan = decideTargets(targetIds, targets, decision);
  if (!plan.ok) return cronError(400, plan.error, `${plan.error}: ${plan.taskId}`);

  // 상태를 먼저 닫는다. 두 탭에서 동시에 눌러도 한쪽만 이긴다 — `status = 'pending'` 조건이
  // 없으면 둘 다 통과해 `unblock` 이 두 번 나간다.
  const closed = await db
    .update(approvals)
    .set({
      status: nextApprovalStatus(decision),
      decidedBy: ctx.userId,
      decidedAt: nowForDb(),
      ...(note ? { decisionNote: note } : {}),
    })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  if (closed.length === 0)
    return cronError(409, "approval_already_decided", "approval already decided");

  for (const t of plan.perTarget)
    await db
      .update(approvalTargets)
      .set({ decision: t.decision })
      .where(and(eq(approvalTargets.approvalId, approvalId), eq(approvalTargets.taskId, t.taskId)));

  // 부분 실패를 감추지 않는다. 성공분을 되돌리지도 않는다 — 되돌리기가 또 실패할 수 있고,
  // 이미 실행이 시작됐을 수 있다.
  const failed: { task_id: string; code: string }[] = [];
  for (const taskId of plan.unblock) {
    const res = await ctx.client.kanban.runTaskAction(ctx.boardSlug, taskId, "unblock", {});
    if (!res.ok) failed.push({ task_id: taskId, code: res.failure.code || "unblock_failed" });
  }

  // 반려·수정 요청의 말은 카드 댓글로 남긴다 — 직원이 그 카드를 다시 집을 때 읽는다.
  // 빈 메모로는 댓글을 남기지 않는다(소음이다).
  if (note && decision !== "approve")
    for (const taskId of targetIds)
      await ctx.client.kanban.addComment(ctx.boardSlug, taskId, {
        author: "deskrpg",
        body: note,
      });

  return NextResponse.json({
    ok: true,
    status: nextApprovalStatus(decision),
    unblocked: plan.unblock.filter((id) => !failed.some((f) => f.task_id === id)),
    ...(failed.length > 0 ? { failed } : {}),
  });
}
