/**
 * 판단 모음 REST 의 몸통. 라우트 파일은 위임 3줄(`src/app/api/AGENTS.md`).
 *
 * 줄을 만드는 판정은 `attention-inbox.ts`, 세는 판정은 `needs-attention.ts` 다 — 화면과
 * 운영 지표가 같은 함수를 쓰게 하려고 밖에 뒀다. 여기서는 **모으기만** 한다.
 */
import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { approvals, chatRoomMessages, chatRooms, db } from "@/db";
import { buildAttentionInbox, type AttentionInboxInput } from "@/lib/attention-inbox";
import { approvalBoardSlug, approvalTargetsByApproval } from "@/lib/approvals";
import { parseRoomNotice } from "@/lib/chat-rooms-policy";
import { pluginFailureResponse } from "@/lib/cron-access";
import { getUserId } from "@/lib/internal-rpc";
import { countNeedsAttention } from "@/lib/needs-attention";
import { taskTimeMs } from "@/lib/plugin-time";
import { resolveKanbanChannelContext } from "@/lib/kanban-access";

export type ChannelParams = { params: Promise<{ id: string }> };

/** 사무실 방에 남은 **실패한** 크론 알림. 성공한 실행은 사람이 할 일이 없다. */
const CRON_SCAN_LIMIT = 200;

async function recentCronFailures(channelId: string) {
  const [office] = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(and(eq(chatRooms.channelId, channelId), eq(chatRooms.kind, "office")))
    .limit(1);
  if (!office) return [];
  const rows = await db
    .select({
      id: chatRoomMessages.id,
      noticeJson: chatRoomMessages.noticeJson,
      createdAt: chatRoomMessages.createdAt,
    })
    .from(chatRoomMessages)
    .where(eq(chatRoomMessages.roomId, office.id))
    .orderBy(desc(chatRoomMessages.createdAt))
    .limit(CRON_SCAN_LIMIT);
  const out: AttentionInboxInput["cronFailures"][number][] = [];
  for (const row of rows) {
    const notice = parseRoomNotice(row.noticeJson);
    if (!notice || notice.kind !== "cron_result" || notice.status !== "error") continue;
    out.push({
      messageId: row.id,
      jobId: notice.jobId,
      jobName: notice.jobName,
      createdAt: String(row.createdAt),
    });
  }
  return out;
}

/** GET — 사람이 답해야 하는 것만. */
export async function getAttentionInbox(req: NextRequest, channelId: string) {
  const resolved = await resolveKanbanChannelContext({ userId: getUserId(req), channelId });
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  const pending = await db
    .select({
      id: approvals.id,
      title: approvals.title,
      requestedBy: approvals.requestedBy,
      createdAt: approvals.createdAt,
      payloadJson: approvals.payloadJson,
    })
    .from(approvals)
    .where(and(eq(approvals.channelId, channelId), eq(approvals.status, "pending")));
  const targets = await approvalTargetsByApproval(pending.map((a) => a.id));

  // 기본 보드만 읽으면 **다른 보드의 승인 대기 카드가 줄에서 빠진다.** 대기 중인 승인이
  // 가리키는 보드를 함께 읽는다. 한 보드가 실패하면 그 보드만 건너뛴다 — 한 보드 때문에
  // 화면 전체가 비면 사용자가 아무것도 못 본다.
  const slugs = new Set<string>([ctx.boardSlug]);
  for (const a of pending) {
    const slug = approvalBoardSlug(a.payloadJson);
    if (slug) slugs.add(slug);
  }
  const cardsBySlug: { id: string; status: string; title: string; at: string | null }[] = [];
  let anyBoardOk = false;
  for (const slug of slugs) {
    const board = await ctx.client.kanban.getBoard(slug, {});
    if (!board.ok) {
      // 기본 보드가 실패하면 화면에 이유를 보여야 한다 — 그것까지 감추지 않는다.
      if (slug === ctx.boardSlug) return pluginFailureResponse(board);
      continue;
    }
    anyBoardOk = true;
    for (const column of board.data.columns)
      for (const task of column.tasks) {
        const ms = taskTimeMs(task.created_at);
        cardsBySlug.push({
          id: task.id,
          status: task.status,
          title: task.title,
          at: ms === null ? null : new Date(ms).toISOString(),
        });
      }
  }
  if (!anyBoardOk)
    return NextResponse.json({ rows: [], counts: countNeedsAttention([], new Set()) });

  // 카드 시각은 **epoch 초**로 온다 — `Date.parse` 를 부르면 NaN 이라 경과 시간이 조용히
  // 사라진다. 그 판정은 `taskTimeMs` 한 곳에만 둔다(위 루프에서 읽었다).
  const cards = cardsBySlug;
  const input: AttentionInboxInput = {
    cards,
    approvals: pending.map((a) => ({
      id: a.id,
      title: a.title,
      requestedBy: a.requestedBy,
      createdAt: String(a.createdAt),
      taskIds: targets.get(a.id) ?? [],
    })),
    cronFailures: await recentCronFailures(channelId),
  };

  const pendingTaskIds = new Set<string>();
  for (const list of targets.values()) for (const id of list) pendingTaskIds.add(id);

  return NextResponse.json({
    rows: buildAttentionInbox(input),
    counts: countNeedsAttention(cards, pendingTaskIds),
  });
}
