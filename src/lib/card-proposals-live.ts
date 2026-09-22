import { reviewPolicyFailure } from "@/lib/kanban-access";
/**
 * 카드 제안 해소의 **실물 결선**. 판정은 `card-proposals.ts` 가 하고, 여기서는 그 `ResolveDeps`
 * 의 구멍을 DB·플러그인 클라이언트로 채운다.
 *
 * 라우트가 얇게 남도록 배선을 한 곳에 모은다. 규칙은 둘이다.
 *
 * - **관문은 기존 것을 그대로 쓴다**(`resolveKanbanChannelContext`). 게이트가 만든 응답은
 *   문구를 다시 짓지 않고 `response` 로 실어 보낸다.
 * - **플러그인 실패는 status·code 를 잃지 않는다.** `ProposalStepError` 로 던져 도메인 로직이
 *   롤백을 판단하고, 라우트가 그 status 로 내려보낸다.
 */

import { and, eq, like } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { chatRoomMessages, chatRooms, db } from "@/db";
import {
  ProposalStepError,
  type CardProposalNotice,
  type ProposalRecord,
  type ResolveDeps,
} from "@/lib/card-proposals";
import { parseRoomNotice } from "@/lib/chat-rooms-policy";
import { cronError } from "@/lib/cron-access";
import type { PluginResponse } from "@/lib/hermes/plugin-client-types";
import {
  resolveAssignee,
  resolveKanbanChannelContext,
  type KanbanChannelContext,
} from "@/lib/kanban-access";

/** 플러그인 실패를 status·code 를 보존한 채 던진다. 0 status(네트워크)는 503 으로. */
function throwPluginFailure(res: Extract<PluginResponse<unknown>, { ok: false }>): never {
  const status = res.status > 0 ? res.status : res.failure.code === "timeout" ? 504 : 503;
  throw new ProposalStepError(status, res.failure.code, res.failure.message);
}

/**
 * 이 채널의 방 메시지 중 그 제안 알림 한 건. `notice_json` 은 문자열이므로 `like` 로 후보를
 * 좁히고 파싱해서 **정확히** 맞는 것만 인정한다(부분 일치로 남의 제안을 잡지 않는다).
 */
async function loadProposalRecord(input: {
  channelId: string;
  proposalId: string;
}): Promise<ProposalRecord | null> {
  const rows = await db
    .select({ messageId: chatRoomMessages.id, noticeJson: chatRoomMessages.noticeJson })
    .from(chatRoomMessages)
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMessages.roomId))
    .where(
      and(
        eq(chatRooms.channelId, input.channelId),
        like(chatRoomMessages.noticeJson, `%${input.proposalId}%`),
      ),
    );
  for (const row of rows) {
    const notice = parseRoomNotice(row.noticeJson);
    if (notice?.kind !== "card_proposal" || notice.proposalId !== input.proposalId) continue;
    return { messageId: row.messageId, notice };
  }
  return null;
}

/** 알림의 `resolved` 를 되쓴다. 같은 메시지의 나머지 필드는 건드리지 않는다. */
async function writeProposalResolved(input: {
  record: ProposalRecord;
  resolved: NonNullable<CardProposalNotice["resolved"]>;
}): Promise<void> {
  const next: CardProposalNotice = { ...input.record.notice, resolved: input.resolved };
  await db
    .update(chatRoomMessages)
    .set({ noticeJson: JSON.stringify(next) })
    .where(eq(chatRoomMessages.id, input.record.messageId));
}

/**
 * 카드 본문. 플러그인의 `CreateTaskBody` 에는 `acceptance` 칸이 없어 본문에 이어 붙인다 —
 * 제안의 완료 조건을 버리면 카드가 제안보다 빈약해진다. 머리말은 에이전트가 읽는
 * 마크다운이므로 사람 화면의 로케일과 무관하다.
 */
function taskBody(task: { body?: string; acceptance?: string }): string | undefined {
  const parts = [task.body, task.acceptance ? `## Acceptance\n${task.acceptance}` : undefined];
  const joined = parts.filter(Boolean).join("\n\n");
  return joined || undefined;
}

/**
 * 실물 deps 한 벌 + 관문이 풀어 준 컨텍스트를 되읽는 창구. 라우트는 성공 뒤에 dispatch·폴링을
 * 하려고 관문을 **다시 통과시키지 않는다** — 한 요청에서 게이트를 두 번 태우면 Hermes 호출도
 * 두 번이다.
 */
export function liveResolveDeps(): {
  deps: ResolveDeps<KanbanChannelContext>;
  gatedContext(): KanbanChannelContext | null;
} {
  let gated: KanbanChannelContext | null = null;
  const deps: ResolveDeps<KanbanChannelContext> = {
    gate: async ({ userId, channelId, choice }) => {
      const gate = await resolveKanbanChannelContext({ userId, channelId });
      if (gate.ok) {
        const failure = choice === "card" ? reviewPolicyFailure(gate.ctx) : null;
        if (failure)
          return { ok: false, status: 428, code: "review_policy_required", response: failure };
        gated = gate.ctx;
        return { ok: true, ctx: gate.ctx };
      }
      // 게이트가 만든 응답을 그대로 실어 보낸다 — 문구·extra 를 다시 짓지 않는다.
      const status = gate.response.status;
      return { ok: false, status, code: `gate_${status}`, response: gate.response };
    },

    loadProposal: loadProposalRecord,

    markResolved: async ({ ctx, proposalId, choice }) => {
      const res = await ctx.client.cardProposals.resolve(proposalId, { choice });
      if (res.ok) return true;
      // 409 는 오류가 아니라 판정이다 — 이미 누군가 골랐다.
      if (res.status === 409) return false;
      throwPluginFailure(res);
    },

    unresolve: async ({ ctx, proposalId }) => {
      const res = await ctx.client.cardProposals.unresolve(proposalId);
      if (!res.ok) throwPluginFailure(res);
    },

    /**
     * 실물 `resolveAssignee` 는 실패를 `{ok:false, response}` 로 낸다 — 코드가 없다. 실패
     * 갈래가 하나(이 채널에 출근 중인 NPC 가 아니다)뿐이므로 그 코드를 여기서 붙인다.
     * 붙이지 않으면 담당 판정 실패가 도메인 로직에 다른 모양으로 흘러간다.
     */
    resolveAssignee: async ({ ctx, npcId }) => {
      const result = await resolveAssignee(ctx, npcId);
      return result.ok
        ? { ok: true, profileName: result.profileName }
        : { ok: false, code: "assignee_not_in_channel" };
    },

    createTask: async ({ ctx, task }) => {
      const body = taskBody(task);
      const res = await ctx.client.kanban.createTask(ctx.boardSlug, {
        title: task.title,
        review_policy: { version: 1, mode: "human", reviewer_profile: null },
        ...(body ? { body } : {}),
        ...(task.assignee ? { assignee: task.assignee } : {}),
      });
      if (!res.ok) throwPluginFailure(res);
      return { task: { id: res.data.task.id } };
    },

    /**
     * 만든 카드 id 를 제안에 기록한다 — 플러그인의 "카드가 기록된 제안은 되돌릴 수 없다"
     * 가드가 이 호출로만 살아난다(해소가 카드 생성보다 먼저이므로 `resolve` 에는 실을 수 없다).
     * 실패는 `ProposalStepError` 로 던지고, 흐름을 막을지는 도메인 로직이 정한다(막지 않는다).
     */
    recordTask: async ({ ctx, proposalId, taskId }) => {
      const res = await ctx.client.cardProposals.recordTask(proposalId, { task_id: taskId });
      if (!res.ok) throwPluginFailure(res);
    },

    writeResolved: writeProposalResolved,
  };
  return { deps, gatedContext: () => gated };
}

/** 실패 응답 하나. 관문이 만든 응답이 있으면 그대로, 없으면 코드·문구로 짓는다. */
export function proposalFailureResponse(outcome: {
  status: number;
  code: string;
  message?: string;
  response?: NextResponse;
}): NextResponse {
  if (outcome.response) return outcome.response;
  return cronError(outcome.status, outcome.code, outcome.message ?? outcome.code);
}
