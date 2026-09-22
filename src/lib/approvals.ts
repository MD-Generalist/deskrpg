/**
 * 실행 전 승인 관문 — 카드를 `blocked` 로 세우고 승인 레코드를 함께 만든다.
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
import { resolveAssignee, reviewPolicyFailure } from "@/lib/kanban-access";
import { requestEmitRoomMessage } from "@/lib/automation-registry";
import { appendRoomMessage, ensureOfficeRoom } from "@/lib/chat-rooms";
import { getChannelOwnerId } from "@/lib/chat-rooms";
import { parseRequester } from "@/lib/approval-requester";

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
  if (reviewPolicyFailure(ctx)) return { ok: false, errorCode: "review_policy_required" };
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
      review_policy: { version: 1, mode: "human", reviewer_profile: null },
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

  // 재시도는 설계가 약속한 경로다 — 일부 실패하면 버튼이 남고 사용자가 다시 누른다.
  // 멱등 키 덕에 Hermes 는 같은 카드를 돌려주지만, 여기서 무조건 새 승인을 만들면
  // **같은 카드를 가리키는 pending 승인이 하나 더** 생긴다. 사용자가 둘 중 하나를
  // 승인하면 카드는 풀리는데 나머지는 판단 모음에 영영 pending 으로 남는다.
  // 필드를 명시해 직렬화한다. `JSON.stringify(input.source)` 는 **키 순서**를 따르므로,
  // 호출자가 `{id, kind}` 순으로 만들면 같은 출처인데 문자열이 달라 새 승인이 생긴다.
  const sourceJson = JSON.stringify({ kind: input.source.kind, id: input.source.id });
  const [existing] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.channelId, ctx.channelId),
        eq(approvals.type, input.type),
        eq(approvals.status, "pending"),
        eq(approvals.sourceJson, sourceJson),
      ),
    )
    .limit(1);

  let approvalId: string;
  if (existing) {
    approvalId = existing.id;
    const already = new Set(await approvalTargetIds(approvalId));
    // PK 가 중복 insert 를 막기는 하지만, 조용히 삼키지 않고 없는 것만 넣는다.
    const missing = created.filter((taskId) => !already.has(taskId));
    if (missing.length > 0)
      await db.insert(approvalTargets).values(missing.map((taskId) => ({ approvalId, taskId })));
  } else {
    approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      channelId: ctx.channelId,
      type: input.type,
      status: "pending",
      requestedBy: input.requestedBy,
      title: input.title,
      sourceJson,
      // 이 승인의 카드가 **어느 보드에 있는지**. 이것이 없으면 결정이 늘 채널 기본 보드로
      // `unblock` 을 보내고, 카드가 다른 보드에 있으면 전부 `task_not_found` 로 실패하는데
      // 승인은 이미 닫혀 있다 — 승인했는데 아무 일도 안 일어난다.
      payloadJson: JSON.stringify({ boardSlug: board }),
    });
    try {
      await db.insert(approvalTargets).values(created.map((taskId) => ({ approvalId, taskId })));
    } catch (error) {
      // 두 insert 를 한 트랜잭션으로 묶을 수 없다 — better-sqlite3 드라이버는 트랜잭션
      // 콜백이 Promise 를 돌려주는 것을 거부한다("Transaction function cannot return a
      // promise", 실측 2026-09-21). 그래서 보상 삭제로 같은 보장을 만든다: 대상 0행짜리
      // `task_execution` 승인은 누를 것이 없는 소음이므로 남기지 않는다.
      await db.delete(approvals).where(eq(approvals.id, approvalId));
      throw error;
    }
  }

  await announceApproval(ctx.channelId, approvalId, input, created.length);

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

/**
 * 승인 요청을 사무실 방에 알린다.
 *
 * **시스템 메시지다.** 요청 주체가 사람(`user:<id>`)인 묶음을 직원 발화로 그리면 직원이
 * 하지 않은 말을 한 것이 된다. 직원이 요청한 경우에도 "시스템이 사람에게 묻는 것" 으로
 * 통일하고, 누가 요청했는지는 알림 본문이 `parseRequester` 로 갈라 말한다.
 *
 * **실패해도 던지지 않는다.** 알림이 늦게 보이는 것과 승인이 아예 안 생기는 것은 무게가
 * 다르다. 행이 남으면 사용자가 방을 열 때 보이고, 방송만 실패하면 다음 새로고침에 보인다.
 */
async function announceApproval(
  channelId: string,
  approvalId: string,
  input: ApprovalBatchInput,
  targetCount: number,
): Promise<void> {
  try {
    const ownerId = await getChannelOwnerId(channelId);
    if (!ownerId) return;
    const room = await ensureOfficeRoom(channelId, ownerId);
    const requester = parseRequester(input.requestedBy);
    const message = await appendRoomMessage({
      roomId: room.id,
      senderKind: "system",
      senderId: null,
      senderName: "",
      // 로케일 무관 폴백. 문장은 보는 사람의 언어로 렌더러가 만든다.
      content: input.title,
      notice: {
        kind: "approval_requested",
        approvalId,
        title: input.title,
        npcName: requester.kind === "profile" ? requester.profileName : "",
        targetCount,
      },
    });
    requestEmitRoomMessage(room.id, message);
  } catch {
    // 알림 실패가 승인 생성을 실패시키지 않는다.
  }
}

/** 이 승인의 카드가 있는 보드. 옛 행(`payload_json` 없음)은 채널 기본 보드로 읽는다. */
export function approvalBoardSlug(payloadJson: string | null | undefined): string | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as { boardSlug?: unknown };
    return typeof parsed.boardSlug === "string" && parsed.boardSlug ? parsed.boardSlug : null;
  } catch {
    return null;
  }
}
