/**
 * "프로젝트로 등록" 의 몸통 — 회의 결과의 후속 업무를 승인 묶음 하나로 넘긴다.
 *
 * 등록은 카드를 **만들 뿐**이다. 카드는 승인 대기(`blocked`)로 서고 실행은 사용자가 승인한 뒤에
 * 시작한다(`createApprovalBatch`). 회의에서 "소피가 조사한다" 고 말했다는 이유로 일이 돌지 않는다.
 *
 * 회의록에 남기는 것은 만든 카드의 id 목록(연결)뿐이다 — 카드 내용은 복제하지 않는다.
 * 라우트는 얇게 두고 판단은 여기서 한다. DB·Hermes 는 전부 `deps` 로 받는다.
 */
import type { MeetingOutcome, MeetingOutcomeRegistered } from "./meeting-outcome";
import type { OutcomeRegistration } from "./meeting-outcome-draft";
import { isTenantSlug } from "./tenant-slug";

export type RegisterBatchInput = {
  type: "task_execution";
  title: string;
  requestedBy: string;
  source: { kind: "meeting"; id: string };
  boardSlug?: string;
  items: Array<{
    title: string;
    body?: string;
    npcId?: string;
    tenant?: string;
    /** 이 묶음 안의 자리. 회의 결과의 번호가 아니다. */
    parents?: number[];
    idempotencyKey: string;
  }>;
};

export type RegisterBatchResult =
  | {
      ok: true;
      approvalId: string;
      taskIds: (string | null)[];
      failed?: Array<{ index: number; errorCode: string }>;
    }
  | { ok: false; errorCode: string };

type RegisterContext = { isChannelOwner: boolean; boardSlug: string };

export type RegisterMeetingDeps<Ctx extends RegisterContext = RegisterContext> = {
  loadMinutes: (minutesId: string) => Promise<{
    id: string;
    channelId: string;
    topic: string;
    initiatorId: string | null;
    outcome: MeetingOutcome | null;
  } | null>;
  loadChannelOwner: (channelId: string) => Promise<string | null>;
  /** 칸반 관문(로그인 → 멤버 → 게이트웨이 409 → 플러그인 428 → 보드 소속 404 → 보드 확보 503). */
  resolveContext: (input: {
    userId: string;
    channelId: string;
    boardSlug?: string;
  }) => Promise<{ ok: true; ctx: Ctx } | { ok: false; response: Response }>;
  /** 서브프로젝트 메타 행을 확보한다. 이미 있으면 조용히 지나간다. */
  ensureSubproject: (
    ctx: Ctx,
    tenant: { slug: string; name: string },
    minutesId: string,
  ) => Promise<void>;
  createBatch: (ctx: Ctx, input: RegisterBatchInput) => Promise<RegisterBatchResult>;
  saveRegistered: (minutesId: string, registered: MeetingOutcomeRegistered) => Promise<void>;
  requesterForUser: (userId: string) => string;
  now: () => string;
};

export type RegisterMeetingResult =
  | { ok: true; registered: MeetingOutcomeRegistered; approvalId: string }
  | { ok: false; response: Response }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 502;
      errorCode: string;
      /** 회의 결과의 번호로 돌려준다 — 화면이 어느 줄인지 짚을 수 있게. */
      failed?: Array<{ index: number; errorCode: string }>;
    };

type Body = OutcomeRegistration & { boardSlug?: string };

function invalid(errorCode: string): RegisterMeetingResult {
  return { ok: false, status: 400, errorCode };
}

function cardBody(
  followUp: MeetingOutcome["followUps"][number],
  minutes: { id: string; topic: string },
): string {
  return [
    followUp.summary,
    followUp.acceptance ? `완료 조건: ${followUp.acceptance}` : null,
    // 카드에서 회의 결정을 다시 찾는 연결이다. 카드 상세가 이 줄을 "회의록 열기" 로 그린다.
    `출처: 회의록 ${minutes.id} — ${minutes.topic}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function registerMeetingOutcome<Ctx extends RegisterContext>(
  args: { minutesId: string; userId: string; body: Body },
  deps: RegisterMeetingDeps<Ctx>,
): Promise<RegisterMeetingResult> {
  const minutes = await deps.loadMinutes(args.minutesId);
  if (!minutes) return { ok: false, status: 404, errorCode: "not_found" };

  const ownerId = await deps.loadChannelOwner(minutes.channelId);
  const canManage =
    (ownerId !== null && ownerId === args.userId) ||
    (minutes.initiatorId !== null && minutes.initiatorId === args.userId);
  if (!canManage) return { ok: false, status: 403, errorCode: "forbidden" };

  const outcome = minutes.outcome;
  if (!outcome || outcome.followUps.length === 0) return invalid("nothing_to_register");
  if (outcome.registered) return { ok: false, status: 409, errorCode: "already_registered" };

  // --- 본문 검증: 화면이 보낸 번호를 그대로 믿지 않는다 ---
  const { items, tenant } = args.body;
  if (!Array.isArray(items) || items.length === 0) return invalid("nothing_to_register");
  const position = new Map<number, number>();
  for (const [at, item] of items.entries()) {
    if (!Number.isInteger(item.index) || !outcome.followUps[item.index])
      return invalid("invalid_followup_index");
    if (position.has(item.index)) return invalid("invalid_followup_index");
    if (typeof item.title !== "string" || !item.title.trim()) return invalid("invalid_title");
    position.set(item.index, at);
  }
  for (const item of items) {
    // 이번에 등록하지 않는 항목을 기다리면 그 카드는 영영 시작하지 못한다.
    if (!Array.isArray(item.after) || item.after.some((target) => !position.has(target)))
      return invalid("invalid_followup_after");
  }
  if (tenant && (!isTenantSlug(tenant.slug) || !tenant.name?.trim()))
    return invalid("invalid_tenant_slug");

  const resolved = await deps.resolveContext({
    userId: args.userId,
    channelId: minutes.channelId,
    boardSlug: args.body.boardSlug,
  });
  if (!resolved.ok) return { ok: false, response: resolved.response };
  const ctx = resolved.ctx;

  // 프로젝트 메타는 채널 소유자만 바꾸는 표다(`project-routes.ts` 의 requireOwner). 주재자의 등록이
  // 그 규칙을 몰래 넓히지 않게 한다 — 카드에는 테넌트가 붙고, 메타 없는 테넌트도 뷰에서 슬러그로 보인다.
  if (tenant && ctx.isChannelOwner) await deps.ensureSubproject(ctx, tenant, minutes.id);

  const batch = await deps.createBatch(ctx, {
    type: "task_execution",
    title: minutes.topic,
    requestedBy: deps.requesterForUser(args.userId),
    source: { kind: "meeting", id: minutes.id },
    boardSlug: ctx.boardSlug,
    items: items.map((item) => ({
      title: item.title.trim(),
      body: cardBody(outcome.followUps[item.index], minutes),
      ...(item.npcId ? { npcId: item.npcId } : {}),
      ...(tenant ? { tenant: tenant.slug } : {}),
      parents: item.after.map((target) => position.get(target) as number),
      // 같은 회의의 같은 항목은 몇 번을 눌러도 카드 한 장이다.
      idempotencyKey: `meeting:${minutes.id}:${item.index}`,
    })),
  });

  if (!batch.ok) return { ok: false, status: 502, errorCode: batch.errorCode };

  if (batch.failed?.length || batch.taskIds.some((id) => id === null)) {
    // 등록 완료로 표시하지 않는다. 버튼이 남고, 멱등 키와 승인 재사용 덕에 다시 눌러도 안전하다.
    return {
      ok: false,
      status: 502,
      errorCode: "partially_registered",
      failed: (batch.failed ?? []).map((failure) => ({
        index: items[failure.index]?.index ?? failure.index,
        errorCode: failure.errorCode,
      })),
    };
  }

  const registered: MeetingOutcomeRegistered = {
    boardSlug: ctx.boardSlug,
    tenant: tenant?.slug ?? null,
    taskIds: batch.taskIds as string[],
    by: args.userId,
    at: deps.now(),
  };
  await deps.saveRegistered(minutes.id, registered);
  return { ok: true, registered, approvalId: batch.approvalId };
}
