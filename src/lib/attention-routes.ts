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
import { approvalTargetsByApproval } from "@/lib/approvals";
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

  const board = await ctx.client.kanban.getBoard(ctx.boardSlug, {});
  if (!board.ok) return pluginFailureResponse(board);

  const pending = await db
    .select({
      id: approvals.id,
      title: approvals.title,
      requestedBy: approvals.requestedBy,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(and(eq(approvals.channelId, channelId), eq(approvals.status, "pending")));
  const targets = await approvalTargetsByApproval(pending.map((a) => a.id));

  // 카드 시각은 **epoch 초**로 온다 — `Date.parse` 를 부르면 NaN 이라 경과 시간이 조용히
  // 사라진다. 그 판정은 `taskTimeMs` 한 곳에만 둔다.
  const cards = board.data.columns.flatMap((column) =>
    column.tasks.map((task) => {
      const ms = taskTimeMs(task.created_at);
      return {
        id: task.id,
        status: task.status,
        title: task.title,
        at: ms === null ? null : new Date(ms).toISOString(),
      };
    }),
  );
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
