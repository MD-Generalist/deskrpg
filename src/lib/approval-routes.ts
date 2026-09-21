/**
 * 승인 결정 REST 의 몸통. 라우트 파일은 얇게 두고 순서를 여기 한 곳에 고정한다
 * (`src/app/api/AGENTS.md`).
 *
 * **왜 소유자 전용이 아닌가:** 결정은 채널 멤버면 누구나 한다. 멤버는 이미 카드를 직접
 * `unblock` 할 수 있으므로(`kanban-routes.ts` 의 기존 동작) 여기서 좁혀도 권한이 실제로
 * 줄지 않고, 승인을 기다리는 일만 늘어난다.
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
import { approvalBoardSlug, approvalTargetIds } from "@/lib/approvals";
import {
  decideTargets,
  nextApprovalStatus,
  parseDecision,
  type TargetDecision,
} from "@/lib/approval-decision";
import { rewriteRoomNotices } from "@/lib/room-notice-rewrite";
import { cronError } from "@/lib/cron-access";
import { initialStatusGate } from "@/lib/hermes/plugin-capability";
import { pluginUpgradeRequired } from "@/lib/hermes/plugin-errors";
import { getUserId } from "@/lib/internal-rpc";
import { resolveKanbanChannelContext } from "@/lib/kanban-access";
import { dispatchOnce } from "@/lib/kanban-dispatch";
import { schedulePollNow } from "@/lib/automation-poll-trigger";

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
  const userId = getUserId(req);
  if (!userId) return cronError(401, "unauthorized", "unauthorized");

  // 승인을 **먼저** 읽는다. 카드가 어느 보드에 있는지 알아야 컨텍스트를 그 보드로 풀 수
  // 있다. 기본 보드로 풀면 다른 보드의 카드에 `unblock` 이 닿지 않는다.
  // 이 조회는 권한 검사 전이라 **결과를 응답에 싣지 않는다** — 존재 여부가 새지 않게
  // 아래 멤버 검사를 통과한 뒤에만 404/409 를 가른다.
  const [row] = await db
    .select({
      id: approvals.id,
      status: approvals.status,
      payloadJson: approvals.payloadJson,
    })
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.channelId, channelId)))
    .limit(1);

  const resolved = await resolveKanbanChannelContext({
    userId,
    channelId,
    // 옛 행(payload 없음)은 채널 기본 보드다. 슬러그는 소속 검사(404)를 다시 거친다.
    ...(row ? { boardSlug: approvalBoardSlug(row.payloadJson) ?? undefined } : {}),
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

  // 풀 것이 있었는데 **하나도** 못 풀었으면 게이트웨이가 그 순간 안 닿은 것이다. 승인만
  // 닫아 두면 사용자는 카드를 하나씩 손으로 풀어야 하고 다시 누를 pending 도 없다.
  // 트랜잭션을 못 쓰니 보상으로 되돌린다. 일부만 실패한 경우는 되돌리지 않는다 — 이미
  // 실행이 시작된 카드가 있고, 남은 것은 판단 모음의 막힌 카드 줄에 보인다.
  if (plan.unblock.length > 0 && failed.length === plan.unblock.length) {
    await db
      .update(approvals)
      .set({ status: "pending", decidedBy: null, decidedAt: null })
      .where(eq(approvals.id, approvalId));
    return cronError(502, "unblock_failed", "could not unblock any task", { failed });
  }

  // 풀린 카드가 있으면 디스패치를 한 번 요청한다. 카드 액션 라우트는 unblock 뒤 이렇게 하는데,
  // 여기는 unblock 을 직접 보내므로 따로 불러야 한다 — 부르지 않으면 게이트웨이 내장 디스패처의
  // 주기에 맡겨져 카드가 ready 에 머문다(스테이징에서 약 5분). 실패해도 승인은 성공이다.
  if (plan.unblock.length > failed.length) {
    await dispatchOnce(ctx);
    schedulePollNow(channelId);
  }

  // 댓글도 같은 `ctx.boardSlug` 로 간다 — 위에서 승인의 보드로 컨텍스트를 풀었기 때문이다.
  // 반려·수정 요청의 말은 카드 댓글로 남긴다 — 직원이 그 카드를 다시 집을 때 읽는다.
  // 빈 메모로는 댓글을 남기지 않는다(소음이다).
  if (note && decision !== "approve")
    for (const taskId of targetIds)
      await ctx.client.kanban.addComment(ctx.boardSlug, taskId, {
        author: "deskrpg",
        body: note,
      });

  // 방의 승인 요청 줄이 결과를 말하게 한다 — 그러지 않으면 결정한 뒤에도 "승인 열기" 가 남는다.
  await rewriteRoomNotices({
    channelId,
    needle: approvalId,
    update: (notice) =>
      notice.kind === "approval_requested" && notice.approvalId === approvalId
        ? {
            ...notice,
            resolved: {
              decision: nextApprovalStatus(decision),
              by: ctx.userId,
              at: new Date().toISOString(),
            },
          }
        : null,
  });

  return NextResponse.json({
    ok: true,
    status: nextApprovalStatus(decision),
    unblocked: plan.unblock.filter((id) => !failed.some((f) => f.task_id === id)),
    ...(failed.length > 0 ? { failed } : {}),
  });
}
