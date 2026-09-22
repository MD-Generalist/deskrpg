/**
 * 카드 제안 해소의 도메인 로직 — "한 번만, 실패는 되돌린다".
 *
 * NPC 가 대화 중 낸 업무 카드 제안(`chat_room_messages.notice_json` 의 `card_proposal`)을
 * 사용자가 `card`(이슈카드등록)·`inline`(여기서 처리) 중 하나로 고르면 이 함수가 돈다.
 * Hermes 가 제안과 카드의 정본이므로 DeskRPG 에는 사본 테이블이 없다 — 여기서 쓰는 것은
 * 알림의 `resolved` 뿐이다.
 *
 * 순서가 곧 규칙이다.
 *
 *   1. DeskRPG 관문(로그인→멤버→게이트웨이 409→플러그인 428→보드 503)과 제안 조회를 **먼저**
 *      통과시킨다. 여기서 막히면 플러그인은 건드리지 않는다 — 뒤에서 실패할 창을 좁힌다.
 *   2. 플러그인에 해소를 표시한다. 이미 해소돼 있으면(409) **거기서 끝낸다.** 이것이 카드가
 *      한 번만 만들어지게 하는 관문이다 — DeskRPG 쪽 상태가 아니라 플러그인의 판정이 정본이다.
 *   3. `card` 면 담당을 판정한다. 제안한 NPC 가 퇴근했거나 게이트웨이가 바뀌었으면 담당 없이
 *      진행하고 `assigneeDropped: true` 를 남긴다 — Hermes 가 담당 없는 카드를 triage 로 둔다.
 *   4. 카드를 만든다.
 *   5. 카드 생성이 실패하면 2번을 되돌린다(`unresolve`). 되돌리지 않으면 "카드는 없는데 버튼도
 *      못 누르는" 상태가 남는다. 되돌린 뒤에는 `notice_json` 을 **건드리지 않는다** — 알림이
 *      미결로 남아야 사용자가 다시 고를 수 있다. 되돌리기 자체가 실패하면 그 사실을 오류로
 *      올린다(조용히 삼키면 사람이 손쓸 수 없다).
 *   6. 성공이면 알림에 `resolved` 를 쓴다.
 *
 * `inline` 은 3~5 를 건너뛴다. 후속 대화는 방 메시지 → NPC 응답이라는 **기존 경로**가 맡고,
 * 여기서는 아무 것도 만들지 않는다.
 *
 * DB·HTTP 접근은 전부 `ResolveDeps` 로 주입받는다. 이 파일은 판정만 하고, 배선은 라우트가
 * 한다 — 그래서 테스트가 스텁만으로 순서와 롤백을 고정할 수 있다.
 */

import type { NextResponse } from "next/server";

import type { RoomNotice } from "@/lib/chat-rooms-policy";

export type CardProposalNotice = Extract<RoomNotice, { kind: "card_proposal" }>;

/** 해소가 손대는 알림 한 건. `messageId` 는 `notice_json` 을 되쓸 대상이다. */
export type ProposalRecord = {
  messageId: string;
  notice: CardProposalNotice;
};

/** 만들 카드의 알맹이 — 제안에서 그대로 옮긴다. 없는 필드는 키 자체가 빠진다. */
export type ProposalTaskInput = {
  title: string;
  body?: string;
  acceptance?: string;
  /** 담당 프로필 이름. 담당을 떨어뜨렸으면 없다. */
  assignee?: string;
};

export type ResolveChoice = "card" | "inline";

/**
 * 관문 결과. 실패는 `status`/`code` 로 서술하고, 라우트가 이미 만들어 둔 응답이 있으면
 * `response` 로 그대로 실어 보낸다(게이트가 내리는 문구를 여기서 다시 짓지 않는다).
 */
export type ProposalGateResult<Ctx> =
  | { ok: true; ctx: Ctx }
  | { ok: false; status: number; code: string; message?: string; response?: NextResponse };

export type ProposalAssigneeResult =
  { ok: true; profileName: string } | { ok: false; code: string };

export type ResolveDeps<Ctx = unknown> = {
  /** DeskRPG 관문. `resolveKanbanChannelContext` 를 그대로 싸면 된다. */
  gate(input: {
    userId: string;
    channelId: string;
    choice: "card" | "inline";
  }): Promise<ProposalGateResult<Ctx>>;
  /** 이 채널의 제안 알림. 없으면 null → 404. */
  loadProposal(input: { channelId: string; proposalId: string }): Promise<ProposalRecord | null>;
  /**
   * 플러그인에 해소를 표시한다(`POST /deskrpg/card-proposals/:id/resolve`).
   * `false` 는 이미 해소됨(409) — 오류가 아니라 판정이다. 그 밖의 실패는 throw 한다.
   */
  markResolved(input: { ctx: Ctx; proposalId: string; choice: ResolveChoice }): Promise<boolean>;
  /**
   * 해소 표시를 되돌린다(`POST /deskrpg/card-proposals/:id/unresolve`). 실패하면 throw —
   * 삼키면 안 되는 상태다. 플러그인은 `resolved_task_id` 가 비어 있을 때만 되돌리므로
   * 카드가 기록된 제안이 다시 열리는 길은 없다.
   */
  unresolve(input: { ctx: Ctx; proposalId: string }): Promise<void>;
  /** 담당 판정(`resolveAssignee`). 실패 코드는 여기서 재해석하지 않는다. */
  resolveAssignee(input: { ctx: Ctx; npcId: string }): Promise<ProposalAssigneeResult>;
  /** 카드 생성. 실패는 throw — `ProposalStepError` 면 status·code 가 그대로 올라간다. */
  createTask(input: { ctx: Ctx; task: ProposalTaskInput }): Promise<{ task: { id: string } }>;
  /**
   * 만든 카드 id 를 제안에 기록한다(`POST /deskrpg/card-proposals/:id/task`). 해소가 카드
   * 생성보다 먼저 일어나므로 플러그인의 "카드가 기록된 제안은 되돌릴 수 없다" 가드는 이 호출로만
   * 살아난다. **실패는 치명적이지 않다** — 빠지는 것은 이중 방어뿐이라 흐름을 막지 않고 로그만
   * 남긴다. 실패를 알리고 싶으면 throw 하면 된다(호출부가 잡아 로그한다).
   */
  recordTask(input: { ctx: Ctx; proposalId: string; taskId: string }): Promise<void>;
  /** 알림의 `resolved` 를 쓴다. 실패는 throw. */
  writeResolved(input: {
    record: ProposalRecord;
    resolved: NonNullable<CardProposalNotice["resolved"]>;
  }): Promise<void>;
  /** 결정 시각. 테스트가 고정할 수 있게 주입받는다. 없으면 현재 시각. */
  now?(): Date;
};

export type ResolveOutcome =
  | { ok: true; choice: "card"; taskId: string; assigneeDropped: boolean }
  | { ok: true; choice: "inline" }
  // `message`/`response` 를 `undefined` 로 열어 둔다 — 실패 갈래를 좁히지 않고 한 번에 읽게.
  | { ok: false; status: 409; code: "already_resolved"; message?: undefined; response?: undefined }
  | {
      ok: false;
      status: number;
      code: string;
      message?: string;
      /** 관문이 이미 만든 응답 — 있으면 라우트가 그대로 내려보낸다. */
      response?: NextResponse;
    };

/** 단계 실패를 status·code 로 실어 올린다. 스텁·클라이언트가 같은 모양으로 던진다. */
export class ProposalStepError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ProposalStepError";
    this.status = status;
    this.code = code;
  }
}

/** 모르는 예외는 502 로 접는다 — 원문은 `message` 에 남긴다. */
function asStepFailure(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ProposalStepError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 502, code: "upstream_error", message };
}

export async function resolveProposal<Ctx>(
  input: { channelId: string; userId: string; proposalId: string; choice: ResolveChoice },
  deps: ResolveDeps<Ctx>,
): Promise<ResolveOutcome> {
  if (input.choice !== "card" && input.choice !== "inline") {
    return { ok: false, status: 400, code: "invalid_field" };
  }

  // 1. 관문 — 여기서 막히면 플러그인은 건드리지 않는다.
  const gate = await deps.gate({
    userId: input.userId,
    channelId: input.channelId,
    choice: input.choice,
  });
  if (!gate.ok) {
    return {
      ok: false,
      status: gate.status,
      code: gate.code,
      ...(gate.message ? { message: gate.message } : {}),
      ...(gate.response ? { response: gate.response } : {}),
    };
  }
  const ctx = gate.ctx;

  const record = await deps.loadProposal({
    channelId: input.channelId,
    proposalId: input.proposalId,
  });
  if (!record) return { ok: false, status: 404, code: "card_proposal_not_found" };
  // 값싼 선행 판정 — 정본은 여전히 플러그인의 409 다.
  if (record.notice.resolved) return { ok: false, status: 409, code: "already_resolved" };

  // 2. 해소 표시 — 카드가 한 번만 만들어지게 하는 관문.
  let marked: boolean;
  try {
    marked = await deps.markResolved({ ctx, proposalId: input.proposalId, choice: input.choice });
  } catch (error) {
    return { ok: false, ...asStepFailure(error) };
  }
  if (!marked) return { ok: false, status: 409, code: "already_resolved" };

  let taskId: string | undefined;
  let assigneeDropped = false;

  if (input.choice === "card") {
    // 3. 담당 판정 — 실패는 카드를 막지 않는다. 담당 없이 만들고 그 사실을 알린다.
    const assignee = await deps.resolveAssignee({ ctx, npcId: record.notice.npcId });
    assigneeDropped = !assignee.ok;

    // 4. 카드 생성.
    const task: ProposalTaskInput = {
      title: record.notice.title,
      ...(record.notice.body ? { body: record.notice.body } : {}),
      ...(record.notice.acceptance ? { acceptance: record.notice.acceptance } : {}),
      ...(assignee.ok ? { assignee: assignee.profileName } : {}),
    };
    try {
      const created = await deps.createTask({ ctx, task });
      taskId = created.task.id;
    } catch (error) {
      // 5. 되돌린다. `notice_json` 은 손대지 않는다 — 사용자가 다시 고를 수 있어야 한다.
      const failure = asStepFailure(error);
      try {
        await deps.unresolve({ ctx, proposalId: input.proposalId });
      } catch (rollbackError) {
        const rollback = asStepFailure(rollbackError);
        return {
          ok: false,
          status: 500,
          code: "resolve_rollback_failed",
          message: `${failure.code}: ${failure.message} / rollback ${rollback.code}: ${rollback.message}`,
        };
      }
      return { ok: false, ...failure };
    }

    // 카드 id 를 제안에 기록한다 — 이게 플러그인의 "되돌릴 수 없다" 가드를 살린다.
    // 실패해도 흐름을 막지 않는다: 카드는 이미 있고 제안도 해소됐으며 빠지는 것은 이중 방어뿐이다.
    // 다만 조용히 삼키지는 않는다 — 가드가 빠진 제안이 있다는 사실은 로그에 남아야 한다.
    try {
      await deps.recordTask({ ctx, proposalId: input.proposalId, taskId });
    } catch (error) {
      const failure = asStepFailure(error);
      console.warn(
        `[card-proposals] recordTask(${input.proposalId}, ${taskId}) failed: ${failure.code}: ${failure.message}`,
      );
    }
  }

  // 6. 알림에 결정을 쓴다. 카드는 이미 Hermes 에 있으므로 되돌리지 않는다 —
  //    실패는 그대로 올려 사람이 알게 한다(taskId 를 문구에 남긴다).
  const at = (deps.now?.() ?? new Date()).toISOString();
  try {
    await deps.writeResolved({
      record,
      resolved: {
        choice: input.choice,
        by: input.userId,
        at,
        ...(taskId ? { taskId } : {}),
      },
    });
  } catch (error) {
    const failure = asStepFailure(error);
    // 갈래가 비대칭이다. 카드가 있으면(`taskId`) 되돌리지 않는다 — 그 카드가 Hermes 의
    // 정본이고, 해소를 되돌려 사용자가 다시 고르면 같은 카드가 또 생긴다. 실패만 정직하게
    // 올린다. (플러그인의 `resolved_task_id` 가 채워졌는지는 별개다 — 바로 위 `recordTask`
    // 실패를 삼키므로 비어 있을 수 있고, 그래도 이 판단은 바뀌지 않는다.)
    // 카드가 없으면(`inline`, 또는 카드를 만들지 않은 갈래) 되돌릴 수 있는 유일한 반쪽 상태다:
    // 되돌려야 사용자가 다시 고르고 후속 대화 경로를 탈 수 있다.
    if (taskId === undefined) {
      try {
        await deps.unresolve({ ctx, proposalId: input.proposalId });
      } catch (rollbackError) {
        const rollback = asStepFailure(rollbackError);
        return {
          ok: false,
          status: 500,
          code: "resolve_rollback_failed",
          message: `notice_write_failed: ${failure.message} / rollback ${rollback.code}: ${rollback.message}`,
        };
      }
      return { ok: false, status: 500, code: "notice_write_failed", message: failure.message };
    }
    return {
      ok: false,
      status: 500,
      code: "notice_write_failed",
      message: `task ${taskId} created but notice not updated: ${failure.message}`,
    };
  }

  return input.choice === "card"
    ? { ok: true, choice: "card", taskId: taskId as string, assigneeDropped }
    : { ok: true, choice: "inline" };
}
