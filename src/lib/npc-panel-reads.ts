/**
 * 직원 대화창의 `카드`·`크론` 탭 배지 — "아직 보지 않은 것" 개수와 그 열람 기록.
 *
 * 세는 일은 순수 함수(`npc-panel-reads-count.ts`)가 하고, 여기서 정하는 것은 조합이다.
 * 핵심 규칙 하나: **두 배지는 서로를 죽이지 않는다.** 보드 조회는 게이트웨이·플러그인·보드
 * 확보가 모두 성공해야 하는 긴 사슬이라 플러그인이 없는 설치에서는 늘 실패하는데, 크론 알림은
 * DeskRPG 의 방 메시지라 그때도 멀쩡하다. 그래서 두 조회를 각각 감싸고, 실패한 쪽만 0 으로 둔다.
 *
 * 보드 쪽은 **읽기 전용 갈래**(`resolveKanbanChannelContextForRead`)로 본다. 배지는 주기적으로
 * 폴링되므로, 본 경로처럼 `ensureChannelBoard` 까지 타면 사용자가 요청하지 않은 Hermes 보드
 * 생성이 반복 시도된다. 권한 관문(로그인·멤버·게이트웨이·플러그인)은 본 경로와 똑같다.
 *
 * 카드 탭은 시각 워터마크를 쓸 수 없다 — `KanbanTask` 에 `updated_at` 이 없다. 그래서 본 카드
 * id 를 쌓고, 쓸 때마다 현재 담당 카드와 교집합으로 가지친다(`pruneSeenIds`).
 */

import { and, eq } from "drizzle-orm";

import {
  chatRoomMessages,
  chatRooms,
  db,
  hermesProfiles,
  isPostgres,
  npcPanelReads,
  npcs,
} from "@/db";
import { assignedCards } from "@/lib/npc-assigned-cards";
import { parseRoomNotice } from "@/lib/chat-rooms-policy";
import { resolveKanbanChannelContextForRead } from "@/lib/kanban-access";
import { pruneSeenIds, unseenCardCount, unseenCronCount } from "@/lib/npc-panel-reads-count";

export type PanelTab = "cron" | "cards";

export const PANEL_TABS: readonly PanelTab[] = ["cron", "cards"];

export function isPanelTab(value: unknown): value is PanelTab {
  return typeof value === "string" && (PANEL_TABS as readonly string[]).includes(value);
}

export type PanelTarget = { channelId: string; userId: string; npcId: string };

export type PanelReadRow = { seenAt: string | null; seenIds: string[] };

/**
 * 배지 출처 하나가 막혔다는 뜻. 상태 코드를 들고 다니지만 라우트는 이걸 응답으로 바꾸지
 * 않는다 — 배지는 "모르면 0" 이 정답이고, 400/428/503 을 내면 나머지 배지까지 사라진다.
 */
export class PanelSourceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${code} (${status})`);
    this.name = "PanelSourceError";
  }
}

export type BadgeDeps = {
  /** 담당 카드 id — 게이트웨이·플러그인·보드 중 하나라도 막히면 `PanelSourceError`. */
  loadAssignedCardIds(target: PanelTarget): Promise<string[]>;
  /** 이 NPC 가 이 채널에 남긴 크론 결과 알림의 시각(ISO, 오름차순일 필요는 없다). */
  loadCronNoticeTimes(target: PanelTarget): Promise<string[]>;
  loadPanelRead(target: PanelTarget, tab: PanelTab): Promise<PanelReadRow | null>;
  savePanelRead(
    target: PanelTarget,
    tab: PanelTab,
    patch: { seenAt: Date; seenIds?: string[] },
  ): Promise<void>;
  now(): Date;
};

export type PanelBadges = { cards: number; cron: number };

/** 실패한 출처는 0 으로 접는다 — 한 쪽의 침묵이 다른 쪽을 가리지 않게. */
async function countOrZero(count: () => Promise<number>): Promise<number> {
  try {
    return await count();
  } catch (err) {
    if (err instanceof PanelSourceError) return 0;
    throw err;
  }
}

export async function readBadges(target: PanelTarget, deps: BadgeDeps): Promise<PanelBadges> {
  const [cards, cron] = await Promise.all([
    countOrZero(async () => {
      const assigned = await deps.loadAssignedCardIds(target);
      const read = await deps.loadPanelRead(target, "cards");
      return unseenCardCount(assigned, read?.seenIds ?? []);
    }),
    countOrZero(async () => {
      const times = await deps.loadCronNoticeTimes(target);
      const read = await deps.loadPanelRead(target, "cron");
      return unseenCronCount(times, read?.seenAt ?? null);
    }),
  ]);
  return { cards, cron };
}

/**
 * 탭을 열었다는 기록. `cards` 면 현재 담당 카드를 모두 본 것으로 만들고 담당에서 빠진 id 는
 * 버린다. `cron` 이면 `seenAt` 만 올린다 — `seenIds` 는 건드리지 않는다(카드 탭의 것이다).
 * 담당 카드를 못 가져오면 `seenIds` 는 그대로 두고 `seenAt` 만 올린다 — 못 본 것을 본 것으로
 * 만들지도, 이미 본 것을 잊지도 않는다.
 */
export async function markTabSeen(
  input: PanelTarget & { tab: PanelTab },
  deps: BadgeDeps,
): Promise<void> {
  const { tab, ...target } = input;
  const seenAt = deps.now();
  if (tab === "cron") {
    await deps.savePanelRead(target, tab, { seenAt });
    return;
  }
  let assigned: string[] | null = null;
  try {
    assigned = await deps.loadAssignedCardIds(target);
  } catch (err) {
    if (!(err instanceof PanelSourceError)) throw err;
  }
  const existing = (await deps.loadPanelRead(target, tab))?.seenIds ?? [];
  const seenIds = assigned
    ? pruneSeenIds(assigned, [...new Set([...existing, ...assigned])])
    : existing;
  await deps.savePanelRead(target, tab, { seenAt, seenIds });
}

// ---------------------------------------------------------------------------
// 실제 배선 — Hermes 보드 · 방 알림 · `npc_panel_reads`
// ---------------------------------------------------------------------------

/** 이 채널에 있는 NPC 의 프로필 이름. `npcs.name` 은 읽지 않는다. */
async function npcProfileName(target: PanelTarget): Promise<string> {
  const [row] = await db
    .select({ profileName: hermesProfiles.profileName })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(and(eq(npcs.id, target.npcId), eq(npcs.channelId, target.channelId)))
    .limit(1);
  if (!row) throw new PanelSourceError(404, "npc_not_found");
  return row.profileName;
}

async function loadAssignedCardIds(target: PanelTarget): Promise<string[]> {
  const gate = await resolveKanbanChannelContextForRead({
    userId: target.userId,
    channelId: target.channelId,
  });
  if (!gate.ok) throw new PanelSourceError(gate.response.status, "board_unavailable");
  const profileName = await npcProfileName(target);
  const board = await gate.ctx.client.kanban.getBoard(gate.ctx.boardSlug);
  if (!board.ok) throw new PanelSourceError(board.status, "board_unavailable");
  return assignedCards(board.data, profileName).map((task) => task.id);
}

async function loadCronNoticeTimes(target: PanelTarget): Promise<string[]> {
  const rows = await db
    .select({ noticeJson: chatRoomMessages.noticeJson, createdAt: chatRoomMessages.createdAt })
    .from(chatRoomMessages)
    .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMessages.roomId))
    .where(
      and(
        eq(chatRooms.channelId, target.channelId),
        eq(chatRoomMessages.senderKind, "npc"),
        eq(chatRoomMessages.senderId, target.npcId),
      ),
    );
  return rows
    .filter((row) => parseRoomNotice(row.noticeJson)?.kind === "cron_result")
    .map((row) => new Date(row.createdAt).toISOString());
}

async function loadPanelRead(target: PanelTarget, tab: PanelTab): Promise<PanelReadRow | null> {
  const [row] = await db
    .select({ seenAt: npcPanelReads.seenAt, seenIds: npcPanelReads.seenIds })
    .from(npcPanelReads)
    .where(
      and(
        eq(npcPanelReads.userId, target.userId),
        eq(npcPanelReads.npcId, target.npcId),
        eq(npcPanelReads.tab, tab),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    seenAt: row.seenAt ? new Date(row.seenAt).toISOString() : null,
    seenIds: parseSeenIds(row.seenIds),
  };
}

/** 깨진 JSON 은 "본 것이 없다" 로 접는다 — 배지가 조금 많이 보일 뿐, 화면은 산다. */
function parseSeenIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function savePanelRead(
  target: PanelTarget,
  tab: PanelTab,
  patch: { seenAt: Date; seenIds?: string[] },
): Promise<void> {
  const seenAt = toDbTimestamp(patch.seenAt);
  const seenIds = patch.seenIds ? JSON.stringify(patch.seenIds) : undefined;
  await db
    .insert(npcPanelReads)
    .values({
      userId: target.userId,
      npcId: target.npcId,
      tab,
      seenAt,
      seenIds: seenIds ?? null,
    })
    .onConflictDoUpdate({
      target: [npcPanelReads.userId, npcPanelReads.npcId, npcPanelReads.tab],
      set: { seenAt, ...(seenIds === undefined ? {} : { seenIds }) },
    });
}

/** PG 드라이버는 `Date`, SQLite 의 TEXT 컬럼은 ISO 문자열을 원한다(`nowForDb` 와 같은 규칙). */
function toDbTimestamp(value: Date): Date {
  return (isPostgres ? value : value.toISOString()) as unknown as Date;
}

export const liveBadgeDeps: BadgeDeps = {
  loadAssignedCardIds,
  loadCronNoticeTimes,
  loadPanelRead,
  savePanelRead,
  now: () => new Date(),
};
