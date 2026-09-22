/**
 * 칸반 REST(`/api/channels/:id/kanban/**`, `/automation/status`)의 문지기.
 *
 * 순서가 곧 규칙이다: 로그인 → 채널 멤버 → 채널의 게이트웨이(409) → 플러그인 계약(428/404/401/
 * 503/504) → 보드 확보(503). 앞 단계가 막히면 뒤 단계(특히 Hermes 호출)는 일어나지 않는다.
 * 게이트는 `resolveChannelBoard` 가 한 번 풀어 준 것을 그대로 쓰고, 그 결과의 오너 클라이언트를
 * 컨텍스트에 싣는다 — 한 요청에서 게이트·클라이언트를 두 번 만들지 않는다. 멤버·오류 응답은
 * `cron-access.ts` 의 것을 **그대로 가져다 쓴다** — 게이트를 두 벌 두면 언젠가 한쪽만 고쳐진다.
 *
 * 크론과 다른 점은 셋이다.
 * - 스코프가 **오너 키**다. 프로필 키는 여기서 쓰지 않는다.
 * - 권한 단위가 보드다. 보기·카드 조작은 채널 멤버, 보드 작업 폴더는 채널 소유자, 호스트
 *   운영 설정(orchestration)은 읽기 = 채널 소유자·수정 = 게이트웨이 리소스 소유자.
 * - 담당자는 `npcId` 로 받아 이 채널에 출근 중인 NPC 의 `profile_name` 으로 바꿔 보낸다(R7).
 *
 * 브라우저는 Hermes 를 직접 부르지 않는다. 오너 토큰은 여기서 복호화해 클라이언트에
 * 가두고, 응답에는 절대 싣지 않는다.
 */

import { and, eq } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { db, hermesProfiles, npcs, users } from "@/db";
import {
  cronError,
  pluginGateResponse,
  requireChannelMember,
  type CronChannelContext,
} from "@/lib/cron-access";
import type { OwnerPluginClient } from "@/lib/hermes/plugin-client-types";
import {
  ensureChannelBoard,
  getChannelBoard,
  getChannelBoardBySlug,
  resolveChannelBoard,
  type ChannelBoardRow,
  type ResolvedChannelBoard,
} from "@/lib/kanban-boards";

/** 자동화 최소 플러그인 버전 — 정본은 `plugin-capability.ts` 하나다. */
export { AUTOMATION_MIN_VERSION as AUTOMATION_MIN_PLUGIN_VERSION } from "@/lib/hermes/plugin-capability";

// ---------------------------------------------------------------------------
// 채널 컨텍스트 — 멤버 + 게이트웨이 + 플러그인 게이트 + 보드
// ---------------------------------------------------------------------------

export type KanbanChannelContext = CronChannelContext & {
  channel: { id: string; ownerId: string };
  /** 요청자가 채널 소유자인가 — 보드 작업 폴더·운영 설정 읽기의 기준. */
  isChannelOwner: boolean;
  /** 요청자가 게이트웨이 리소스 소유자인가 — 운영 설정 수정의 기준. */
  isGatewayOwner: boolean;
  boardSlug: string;
  boardRow: ChannelBoardRow;
  client: OwnerPluginClient;
};

export type KanbanContextResult =
  { ok: true; ctx: KanbanChannelContext } | { ok: false; response: NextResponse };

/**
 * R5. 보드 행이 없거나(바인딩 때 확보 실패) `last_error` 가 남아 있거나 게이트웨이가
 * 바뀌었으면 한 번 다시 확보한다. 그래도 안 되면 503 — 보드 없이는 어떤 칸반 요청도
 * 의미가 없다.
 */
async function requireBoardRow(
  channelId: string,
  resolved: Extract<ResolvedChannelBoard, { ok: true }>,
  requestedSlug?: string,
): Promise<{ ok: true; row: ChannelBoardRow } | { ok: false; response: NextResponse }> {
  const gatewayId = resolved.binding.resource.id;

  // 보드를 명시했으면 **이 채널에 붙어 있는지**부터 본다. 다른 채널의 보드를 slug 로 집어
  // 오는 것을 막는 유일한 관문이고, 확보(503)보다 앞선다 — 남의 보드를 확보해 주면 안 된다.
  if (requestedSlug !== undefined) {
    const row = await getChannelBoardBySlug(channelId, requestedSlug);
    if (!row) {
      return {
        ok: false,
        response: cronError(404, "board_not_bound", "board is not bound to this channel"),
      };
    }
    if (row.gatewayId === gatewayId && !row.lastError) return { ok: true, row };
    // 게이트웨이가 바뀌었거나 지난번 확보가 실패했다 — 그 보드만 다시 확보한다.
    const ensured = await ensureChannelBoard(channelId, resolved, requestedSlug);
    if (ensured.ok) return { ok: true, row: ensured.row };
    return { ok: false, response: cronError(503, ensured.code, ensured.reason || ensured.code) };
  }

  const existing = await getChannelBoard(channelId);
  if (existing && existing.gatewayId === gatewayId && !existing.lastError) {
    return { ok: true, row: existing };
  }
  const ensured = await ensureChannelBoard(channelId, resolved);
  if (ensured.ok) return { ok: true, row: ensured.row };
  return {
    ok: false,
    response: cronError(503, ensured.code, ensured.reason || ensured.code),
  };
}

/**
 * 읽기 전용 갈래 — **이미 있는** 연결 행만 쓴다. 없거나 `last_error` 가 남았거나 게이트웨이가
 * 바뀌었으면 503 이고, 보드를 만들지도 다시 확보하지도 않는다.
 *
 * 배지 폴링처럼 사용자가 요청하지 않은 주기적 읽기가 Hermes 보드 생성을 반복 시도하면 안 된다.
 */
async function existingBoardRow(
  channelId: string,
  resolved: Extract<ResolvedChannelBoard, { ok: true }>,
): Promise<{ ok: true; row: ChannelBoardRow } | { ok: false; response: NextResponse }> {
  const gatewayId = resolved.binding.resource.id;
  const existing = await getChannelBoard(channelId);
  if (existing && existing.gatewayId === gatewayId && !existing.lastError) {
    return { ok: true, row: existing };
  }
  return {
    ok: false,
    response: cronError(503, "board_unavailable", "Channel board is not ready"),
  };
}

export async function resolveKanbanChannelContext(input: {
  userId: string | null;
  channelId: string;
  /**
   * `?board=` 로 명시된 보드. 생략하면 그 채널의 **사건 수신 보드**(이관 전의 유일한 보드)를
   * 쓴다 — 그래서 보드를 모르는 옛 클라이언트도 뜻이 바뀌지 않는다.
   */
  boardSlug?: string;
}): Promise<KanbanContextResult> {
  return resolveContext(input, requireBoardRow);
}

/**
 * 게이트(로그인·멤버·게이트웨이·플러그인)는 본 경로와 **똑같이** 태우고 보드만 확보하지 않는
 * 갈래. 배지처럼 곁다리로 읽기만 하는 경로가 쓴다 — 권한 판정을 약하게 만들지 않으면서
 * 원격 쓰기 부작용만 뗀다.
 */
export async function resolveKanbanChannelContextForRead(input: {
  userId: string | null;
  channelId: string;
}): Promise<KanbanContextResult> {
  return resolveContext(input, existingBoardRow);
}

async function resolveContext(
  input: { userId: string | null; channelId: string; boardSlug?: string },
  acquireBoard: (
    channelId: string,
    resolved: Extract<ResolvedChannelBoard, { ok: true }>,
    requestedSlug?: string,
  ) => Promise<{ ok: true; row: ChannelBoardRow } | { ok: false; response: NextResponse }>,
): Promise<KanbanContextResult> {
  if (!input.userId) {
    return { ok: false, response: cronError(401, "unauthorized", "unauthorized") };
  }
  const access = await requireChannelMember(input.channelId, input.userId);
  if (!access.ok) return access;

  const resolved = await resolveChannelBoard(input.channelId);
  if (!resolved.ok) {
    return {
      ok: false,
      response: cronError(409, "gateway_not_bound", "Channel has no gateway bound"),
    };
  }
  if (!resolved.pluginGate.ok) {
    return { ok: false, response: pluginGateResponse(resolved.pluginGate) };
  }
  const info = resolved.pluginGate.info;

  const board = await acquireBoard(input.channelId, resolved, input.boardSlug);
  if (!board.ok) return board;

  const gateway = resolved.binding.resource;
  return {
    ok: true,
    ctx: {
      userId: input.userId,
      channelId: input.channelId,
      channel: access.channel,
      gateway,
      info,
      timezone: info.timezone ?? null,
      isChannelOwner: access.channel.ownerId === input.userId,
      isGatewayOwner: gateway.ownerUserId === input.userId,
      // 컨텍스트의 boardSlug 는 **확보된 행**의 것이다 — resolved 의 것은 기본 보드 slug 라
      // `?board=` 가 온 요청에서 다르다. 여기서 갈리면 라우트가 엉뚱한 보드를 만진다.
      boardSlug: board.row.boardSlug,
      boardRow: board.row,
      client: resolved.ownerClient,
    },
  };
}

// ---------------------------------------------------------------------------
// 로스터 — assignee(profile_name) ↔ NPC 매핑
// ---------------------------------------------------------------------------

export type RosterEntry = {
  npcId: string;
  /** `hermes_profiles.display_name ?? profile_name` — `npcs.name` 은 절대 읽지 않는다. */
  npcName: string;
  profileName: string;
  active: boolean;
};

/**
 * 이 채널의 NPC 전부(현재 게이트웨이의 프로필만). 잠든 NPC 도 `active:false` 로 싣는다 —
 * 밖에서 만든 카드나 잠든 NPC 의 카드도 이름을 붙여 보여 줘야 하기 때문이다(R7 후단).
 */
export async function loadChannelRoster(
  ctx: Pick<KanbanChannelContext, "channelId" | "gateway">,
): Promise<RosterEntry[]> {
  const rows = await db
    .select({
      npcId: npcs.id,
      active: npcs.active,
      profileName: hermesProfiles.profileName,
      displayName: hermesProfiles.displayName,
      createdAt: npcs.createdAt,
    })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(and(eq(npcs.channelId, ctx.channelId), eq(hermesProfiles.gatewayId, ctx.gateway.id)))
    .orderBy(npcs.createdAt, npcs.id);
  return rows.map((row) => ({
    npcId: row.npcId,
    npcName: row.displayName?.trim() || row.profileName,
    profileName: row.profileName,
    active: Boolean(row.active),
  }));
}

// ---------------------------------------------------------------------------
// 담당자 검증 (R7)
// ---------------------------------------------------------------------------

export type AssigneeResult =
  { ok: true; profileName: string; npcId: string } | { ok: false; response: NextResponse };

/**
 * `npcId` → 이 채널에 **출근 중인**(active) NPC → 현재 게이트웨이의 프로필 이름.
 * 잠든 NPC·다른 채널의 NPC·옛 게이트웨이의 NPC·없는 id 는 전부 400 `assignee_not_in_channel`.
 */
export async function resolveAssignee(
  ctx: Pick<KanbanChannelContext, "channelId" | "gateway">,
  npcId: string,
): Promise<AssigneeResult> {
  const [row] = await db
    .select({ npcId: npcs.id, profileName: hermesProfiles.profileName })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(
      and(
        eq(npcs.id, npcId),
        eq(npcs.channelId, ctx.channelId),
        eq(npcs.active, true),
        eq(hermesProfiles.gatewayId, ctx.gateway.id),
      ),
    )
    .limit(1);
  if (!row) {
    return {
      ok: false,
      response: cronError(
        400,
        "assignee_not_in_channel",
        "Assignee must be an NPC currently working in this channel",
      ),
    };
  }
  return { ok: true, profileName: row.profileName, npcId: row.npcId };
}

// ---------------------------------------------------------------------------
// 댓글 작성자 (R11)
// ---------------------------------------------------------------------------

/** Hermes 에 남기는 작성자 — `deskrpg:<닉네임>`. 닉네임을 못 찾으면 사용자 id 로 대신한다. */
export async function commentAuthorFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ nickname: users.nickname })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return `deskrpg:${row?.nickname?.trim() || userId}`;
}

// ---------------------------------------------------------------------------
// 첨부 지원 여부 (R12)
// ---------------------------------------------------------------------------

export function attachmentsUnsupportedResponse(): NextResponse {
  return cronError(404, "attachments_unsupported", "This plugin does not support attachments");
}

export function supportsAttachments(ctx: Pick<KanbanChannelContext, "info">): boolean {
  return ctx.info.kanban.attachments !== false;
}

/** 신규 업무의 완료 정책을 보장할 수 없으면 쓰기 전에 차단한다. */
export function reviewPolicyFailure(ctx: Pick<KanbanChannelContext, "info">): NextResponse | null {
  return ctx.info?.capabilities.includes("kanban_review_policy_v1")
    ? null
    : cronError(
        428,
        "review_policy_required",
        "Update Hermes and the plugin to enable approval policies",
      );
}
