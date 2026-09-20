/**
 * 실행 전 승인 관문 — 카드를 `blocked` 로 세우고 승인 레코드를 함께 만든다.
 *
 * 설계: `docs/superpowers/specs/2026-09-21-execution-approval-gate-design.md`
 *
 * 왜 `blocked` 인가: Hermes 에서 `initial_status="blocked"` 로 만든 카드는 **sticky** 라
 * `recompute_ready` 가 승격하지 않고 `unblock_task` 만 풀어 준다(실측 2026-09-21).
 * `triage` 는 게이트웨이가 매 틱 자동 분해하므로 대기 자리로 쓸 수 없다.
 *
 * 왜 출처 필드가 Hermes 카드에 없는가: 승인이 필요한지는 **이 경로를 지났는가**로 갈린다.
 * 크론·스웜·작업자가 만든 카드는 여기를 지나지 않으므로 아무 표시 없이 그대로 돈다.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

// 방언 중립 경로로 받는다 — `@/db/schema` 는 PG 전용이라 SQLite 에서 `now()` 가 샌다.
import { approvalTargets, approvals, db } from "@/db";
import type { CreateTaskBody } from "@/lib/hermes/deskrpg-plugin-types";
import { orderApprovalBatch } from "@/lib/approval-batch-order";
import type { KanbanChannelContext } from "@/lib/kanban-access";
import { resolveAssignee } from "@/lib/kanban-access";

export type ApprovalSource = {
  kind: "meeting" | "manual" | "chat_proposal";
  id: string;
};

export type ApprovalBatchInput = {
  type: string;
  title: string;
  /** 요청한 프로필 이름(직원). 사용자 id 가 아니다. */
  requestedBy: string;
  source: ApprovalSource;
  /** dev3 의 `?board=` 가 들어오면 이 인자만 흘려 넣으면 된다. 없으면 채널의 단일 보드. */
  boardSlug?: string;
  items: readonly ApprovalBatchItemInput[];
};

export type ApprovalBatchItemInput = {
  title: string;
  body?: string;
  /** 담당 NPC. 프로필 이름은 서버가 푼다 — 화면은 프로필 이름을 알 필요가 없다. */
  npcId?: string;
  tenant?: string;
  /** 같은 묶음 안 선행 항목의 **인덱스**. 아직 카드가 없어 id 로 가리킬 수 없다. */
  parents?: readonly number[];
  /** 재시도가 카드를 두 번 만들지 않게 한다. 예: `meeting:{minutesId}:{index}` */
  idempotencyKey?: string;
};

export type ApprovalBatchFailure = {
  index: number;
  errorCode: string;
};

export type ApprovalBatchResult =
  | {
      ok: true;
      approvalId: string;
      /** 입력 순서대로. 만들지 못한 자리는 null. */
      taskIds: (string | null)[];
      failed?: ApprovalBatchFailure[];
    }
  | { ok: false; errorCode: string; index?: number };

/**
 * 카드들을 만들고 승인 1건으로 묶는다.
 *
 * 카드는 Hermes, 승인은 DeskRPG 라 **한 트랜잭션이 될 수 없다.** 순서는 카드 먼저,
 * 레코드 나중이다 — 반대로 하면 카드 생성이 실패했을 때 대상 없는 승인이 남는다.
 * 레코드 생성이 실패하면 카드는 `blocked` 로 남고, 판단 모음의 "차단된 카드" 줄이
 * 승인 레코드 없는 고아로 드러낸다.
 *
 * **한 장도 못 만들었으면 승인을 만들지 않는다.** 누를 것이 없는 승인은 소음이다.
 */
export async function createApprovalBatch(
  ctx: KanbanChannelContext,
  input: ApprovalBatchInput,
): Promise<ApprovalBatchResult> {
  const ordered = orderApprovalBatch(input.items);
  if (!ordered.ok) return { ok: false, errorCode: ordered.error, index: ordered.index };

  const board = input.boardSlug ?? ctx.boardSlug;
  const taskIds: (string | null)[] = input.items.map(() => null);
  const failed: ApprovalBatchFailure[] = [];

  for (const index of ordered.order) {
    const item = input.items[index];
    const parentIndexes = item.parents ?? [];
    const parents = parentIndexes.map((p) => taskIds[p]);
    if (parents.some((id) => id === null)) {
      // 선행이 실패했다. 이 카드를 만들면 영영 풀리지 않는 부모를 기다린다.
      failed.push({ index, errorCode: "parent_failed" });
      continue;
    }

    let assignee: string | undefined;
    if (item.npcId) {
      const resolved = await resolveAssignee(ctx, item.npcId);
      if (!resolved.ok) {
        // `resolveAssignee` 는 라우트용이라 NextResponse 를 준다. 여기서는 묶음의 한 줄이
        // 실패한 것이므로 응답을 버리고 코드만 남긴다 — 나머지 카드는 계속 만든다.
        failed.push({ index, errorCode: "assignee_not_in_channel" });
        continue;
      }
      assignee = resolved.profileName;
    }

    const body: CreateTaskBody = {
      title: item.title,
      // 관문의 핵심 — 처음부터 세운다. 만든 뒤 상태를 바꾸면 그 사이 dispatch 가 나간다.
      initial_status: "blocked",
      ...(item.body ? { body: item.body } : {}),
      ...(assignee ? { assignee } : {}),
      ...(item.tenant ? { tenant: item.tenant } : {}),
      ...(parents.length > 0 ? { parents: parents as string[] } : {}),
      ...(item.idempotencyKey ? { idempotency_key: item.idempotencyKey } : {}),
    };
    const res = await ctx.client.kanban.createTask(board, body);
    if (!res.ok) {
      failed.push({ index, errorCode: res.failure.code || "create_failed" });
      continue;
    }
    taskIds[index] = res.data.task.id;
  }

  const created = taskIds.filter((id): id is string => id !== null);
  if (created.length === 0) return { ok: false, errorCode: "no_tasks_created" };

  const approvalId = randomUUID();
  await db.insert(approvals).values({
    id: approvalId,
    channelId: ctx.channelId,
    type: input.type,
    status: "pending",
    requestedBy: input.requestedBy,
    title: input.title,
    sourceJson: JSON.stringify(input.source),
  });
  await db.insert(approvalTargets).values(created.map((taskId) => ({ approvalId, taskId })));

  return {
    ok: true,
    approvalId,
    taskIds,
    ...(failed.length > 0 ? { failed: failed.sort((a, b) => a.index - b.index) } : {}),
  };
}

/** 이 채널에서 아직 결정되지 않은 승인이 붙들고 있는 카드 id 들. 배지·판단 모음이 쓴다. */
export async function pendingApprovalTaskIds(channelId: string): Promise<Set<string>> {
  const rows = await db
    .select({ taskId: approvalTargets.taskId })
    .from(approvalTargets)
    .innerJoin(approvals, eq(approvals.id, approvalTargets.approvalId))
    .where(and(eq(approvals.channelId, channelId), eq(approvals.status, "pending")));
  return new Set(rows.map((r) => r.taskId));
}

/** 이 승인이 대상으로 삼은 카드 id 들. 결정 라우트가 `unblock` 을 보낼 목록이다. */
export async function approvalTargetIds(approvalId: string): Promise<string[]> {
  const rows = await db
    .select({ taskId: approvalTargets.taskId })
    .from(approvalTargets)
    .where(eq(approvalTargets.approvalId, approvalId));
  return rows.map((r) => r.taskId);
}

/** 여러 승인의 대상을 한 번에. N+1 조회를 막는다. */
export async function approvalTargetsByApproval(
  approvalIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (approvalIds.length === 0) return out;
  const rows = await db
    .select({ approvalId: approvalTargets.approvalId, taskId: approvalTargets.taskId })
    .from(approvalTargets)
    .where(inArray(approvalTargets.approvalId, [...approvalIds]));
  for (const row of rows) {
    const list = out.get(row.approvalId);
    if (list) list.push(row.taskId);
    else out.set(row.approvalId, [row.taskId]);
  }
  return out;
}
