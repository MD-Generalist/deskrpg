/**
 * 프로젝트 목록표 (설계 2026-09-21 project-registry).
 *
 * **보드 = 프로젝트, 테넌트 = 서브프로젝트**다. 보드도 카드도 테넌트 값도 전부 Hermes 정본이고,
 * 여기 남는 것은 Hermes 가 담을 자리가 없는 사람 쪽 정보뿐이다 — 상태·리드 직원·목표일·색·
 * 아이콘·일시정지 사유, 그리고 "왜 이 일을 하는가" 에 답하는 출처 회의.
 *
 * 그래서 **이름·설명·진행률은 저장하지 않는다**(하드 게이트 1).
 * - 이름·설명: Hermes 보드 메타가 정본이다. 바꾸려면 `PATCH /kanban/boards/{slug}` 를 부른다.
 * - 진행률: `GET /kanban/boards` 가 보드마다 `total` 과 상태별 `counts` 를 이미 준다.
 * 목록을 만들 때 그 둘을 읽어 메타 표와 조인한다 — 사본을 두면 언젠가 어긋난다.
 *
 * **메타 행은 지연 생성한다.** 이관 전부터 있던 채널에는 보드만 있고 메타 행이 없다. 그 채널이
 * "프로젝트가 없다" 며 막히면 안 되므로, 목록을 읽거나 서브프로젝트를 만들 때 그 자리에서
 * 기본값으로 만들어 준다(`ensureProjectRow`). 지연 생성은 Hermes 를 부르지 않는다 — 보드는
 * 이미 있고 우리가 만드는 것은 우리 쪽 메타 행뿐이다.
 */

import { and, eq } from "drizzle-orm";

import { channelKanbanBoards, channelProjects, channelSubprojects, db, npcs, nowForDb } from "@/db";
import type { BoardMeta } from "@/lib/hermes/deskrpg-plugin-types";
import type { OwnerPluginClient } from "@/lib/hermes/plugin-client-types";
import {
  ensureChannelBoard,
  ensureChannelCarrier,
  listChannelBoards,
  newChannelBoardSlug,
  type ChannelBoardRow,
} from "@/lib/kanban-boards";
import { isTenantSlug, tenantSlugFromName } from "@/lib/tenant-slug";

export type ProjectRow = typeof channelProjects.$inferSelect;
export type SubprojectRow = typeof channelSubprojects.$inferSelect;

/** Paperclip 의 projects 와 같은 낱말. `paused` 는 상태가 아니라 pauseReason 이 채워진 in_progress 다. */
export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** 목록에서 기본으로 접히는 상태 — 끝난 일이다. 폴링은 계속한다(§5-3). */
export const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

export class ProjectRegistryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

// ---------------------------------------------------------------------------
// 메타 행 — 지연 생성
// ---------------------------------------------------------------------------

async function readProjectByBoardLink(boardLinkId: string): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(channelProjects)
    .where(eq(channelProjects.boardLinkId, boardLinkId))
    .limit(1);
  return row ?? null;
}

/**
 * 그 보드의 프로젝트 메타 행. 없으면 기본값으로 만든다.
 *
 * 이관 전 채널을 막지 않기 위한 장치다. 경합으로 둘이 동시에 만들려 하면 `board_link_id` 유니크가
 * 하나를 거절하는데, 그때는 이긴 쪽의 행을 읽어 돌려준다 — 실패로 만들 이유가 없다.
 */
export async function ensureProjectRow(
  board: ChannelBoardRow,
  seed?: Partial<Pick<ProjectRow, "status" | "originMeetingId" | "createdByUserId">>,
): Promise<ProjectRow> {
  const existing = await readProjectByBoardLink(board.id);
  if (existing) return existing;
  const now = nowForDb();
  try {
    const [created] = await db
      .insert(channelProjects)
      .values({
        boardLinkId: board.id,
        channelId: board.channelId,
        status: seed?.status ?? "planned",
        originMeetingId: seed?.originMeetingId ?? null,
        createdByUserId: seed?.createdByUserId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  } catch (err) {
    const raced = await readProjectByBoardLink(board.id);
    if (raced) return raced;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

/** 화면·덩어리 1 이 받는 한 줄. Hermes 값과 우리 메타를 합친 것이다. */
export type ProjectView = {
  id: string;
  boardSlug: string;
  isEventCarrier: boolean;
  /** Hermes 보드 메타. 보드가 게이트웨이에서 사라졌으면 null 이고 화면이 그것을 말해야 한다. */
  name: string | null;
  description: string | null;
  status: string;
  leadNpcId: string | null;
  targetDate: string | null;
  color: string | null;
  icon: string | null;
  pauseReason: string | null;
  originMeetingId: string | null;
  /** 저장하지 않는다 — Hermes 가 준 값을 그대로 싣는다. */
  progress: { total: number; counts: Record<string, number> } | null;
  lastError: string | null;
};

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function viewOf(
  board: ChannelBoardRow,
  project: ProjectRow,
  meta: (BoardMeta & { counts?: Record<string, number> }) | undefined,
): ProjectView {
  return {
    id: project.id,
    boardSlug: board.boardSlug,
    isEventCarrier: Boolean(board.isEventCarrier),
    name: meta?.name ?? null,
    description: meta?.description ?? null,
    status: project.status,
    leadNpcId: project.leadNpcId,
    targetDate: toIsoDate(project.targetDate),
    color: project.color,
    icon: project.icon,
    pauseReason: project.pauseReason,
    originMeetingId: project.originMeetingId,
    progress: meta ? { total: meta.total ?? 0, counts: meta.counts ?? {} } : null,
    lastError: board.lastError,
  };
}

/**
 * 채널의 프로젝트 목록. 연결 행이 정본이고 Hermes 보드 메타를 덧입힌다.
 *
 * 게이트웨이에 없는 보드도 **숨기지 않는다** — 게이트웨이를 갈아 끼우면(결정 D-1) 메타는 남고
 * 카드는 비는데, 그것을 조용히 감추면 사용자는 프로젝트가 사라진 줄 안다. `name: null` 로 싣고
 * 화면이 "이 게이트웨이에 보드가 없다" 고 말하게 한다.
 */
export async function listChannelProjects(
  channelId: string,
  client: OwnerPluginClient,
): Promise<ProjectView[]> {
  // 읽는 쪽이 고친다 — carrier 가 0개로 떨어진 채널을 여기서 되살린다(§보관의 두 UPDATE 사이).
  await ensureChannelCarrier(channelId);
  const boards = await listChannelBoards(channelId);
  if (boards.length === 0) return [];

  const listed = await client.kanban.listBoards();
  const metaBySlug = new Map<string, BoardMeta & { counts?: Record<string, number> }>();
  if (listed.ok) {
    for (const meta of listed.data.boards) metaBySlug.set(meta.slug, meta);
  }

  const views: ProjectView[] = [];
  for (const board of boards) {
    const project = await ensureProjectRow(board);
    views.push(viewOf(board, project, metaBySlug.get(board.boardSlug)));
  }
  return views;
}

export async function readProject(channelId: string, projectId: string): Promise<ProjectRow> {
  const [row] = await db
    .select()
    .from(channelProjects)
    .where(and(eq(channelProjects.id, projectId), eq(channelProjects.channelId, channelId)))
    .limit(1);
  if (!row) throw new ProjectRegistryError(404, "project_not_found");
  return row;
}

export async function readProjectBoard(project: ProjectRow): Promise<ChannelBoardRow> {
  const [row] = await db
    .select()
    .from(channelKanbanBoards)
    .where(eq(channelKanbanBoards.id, project.boardLinkId))
    .limit(1);
  // 연결 행은 cascade 로 메타를 물고 있으므로 메타가 있는데 연결이 없을 수는 없다.
  if (!row) throw new ProjectRegistryError(404, "project_not_found");
  return row;
}

// ---------------------------------------------------------------------------
// 생성
// ---------------------------------------------------------------------------

/**
 * 채널당 보드 상한. 이유는 크론 사건이다 — 플러그인의 `/deskrpg/events` 는 보드마다 크론 tail 을
 * 다시 훑고, 우리는 사건 수신 보드가 아닌 행에서 그 사건을 버린다(§2-3). 보드가 늘수록 그 헛일이
 * 선형으로 는다. 폴링 지연을 재고 조정할 숫자이지 구조적 한계가 아니다.
 */
export const MAX_BOARDS_PER_CHANNEL = 20;

export type CreateProjectInput = {
  name: string;
  description?: string;
  status?: string;
  leadNpcId?: string | null;
  targetDate?: string | null;
  color?: string | null;
  icon?: string | null;
  originMeetingId?: string | null;
  createdByUserId: string;
  subprojects?: { tenantSlug?: string; name: string; description?: string }[];
};

/**
 * 프로젝트(= 보드)를 만든다.
 *
 * **순서가 규칙이다.** Hermes 에 보드를 만들고, 성공했을 때만 연결 행과 메타 행을 쓴다. 뒤집으면
 * 정본 없는 메타가 남아 목록이 존재하지 않는 프로젝트를 보여 준다.
 */
export async function createChannelProject(
  channelId: string,
  client: OwnerPluginClient,
  input: CreateProjectInput,
): Promise<{ project: ProjectView; subprojects: SubprojectRow[] }> {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ProjectRegistryError(400, "invalid_project_name");
  if (input.status !== undefined && !isProjectStatus(input.status))
    throw new ProjectRegistryError(400, "invalid_project_status");

  const boards = await listChannelBoards(channelId);
  if (boards.length >= MAX_BOARDS_PER_CHANNEL)
    throw new ProjectRegistryError(409, "board_limit_reached");

  // 서브프로젝트 슬러그는 **보드를 만들기 전에** 검증한다 — 나중에 걸리면 Hermes 에 빈 보드가 남는다.
  const subprojects = (input.subprojects ?? []).map((sub) => resolveSubprojectSlug(sub));
  assertUniqueSlugs(subprojects.map((s) => s.tenantSlug));

  const slug = newChannelBoardSlug(channelId);
  const ensured = await ensureChannelBoard(channelId, undefined, slug);
  if (!ensured.ok) throw new ProjectRegistryError(503, ensured.code, ensured.reason);

  // 보드 이름은 Hermes 가 정본이다. `createBoard` 는 같은 slug 면 이름을 덮어쓰지 않으므로
  // 새로 만든 보드에 사용자가 고른 이름을 붙이려면 PATCH 를 한 번 더 부른다.
  const patched = await client.kanban.updateBoard(slug, {
    name,
    ...(input.description === undefined ? {} : { description: input.description }),
  });
  if (!patched.ok)
    throw new ProjectRegistryError(503, patched.failure.code, patched.failure.message);

  const now = nowForDb();
  const [project] = await db
    .insert(channelProjects)
    .values({
      boardLinkId: ensured.row.id,
      channelId,
      status: isProjectStatus(input.status) ? input.status : "planned",
      leadNpcId: input.leadNpcId ?? null,
      targetDate: input.targetDate ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      originMeetingId: input.originMeetingId ?? null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const created: SubprojectRow[] = [];
  for (const sub of subprojects) {
    created.push(await insertSubproject(project.id, sub, input.originMeetingId ?? null));
  }

  return {
    project: viewOf(ensured.row, project, patched.data.board),
    subprojects: created,
  };
}

// ---------------------------------------------------------------------------
// 수정·보관
// ---------------------------------------------------------------------------

export type UpdateProjectInput = {
  name?: string;
  description?: string;
  status?: string;
  leadNpcId?: string | null;
  targetDate?: string | null;
  color?: string | null;
  icon?: string | null;
  pauseReason?: string | null;
};

export async function updateChannelProject(
  channelId: string,
  projectId: string,
  client: OwnerPluginClient,
  input: UpdateProjectInput,
): Promise<ProjectView> {
  const project = await readProject(channelId, projectId);
  const board = await readProjectBoard(project);

  if (input.status !== undefined && !isProjectStatus(input.status))
    throw new ProjectRegistryError(400, "invalid_project_status");

  // 이름·설명은 Hermes 정본이라 우리 표에 쓰지 않고 그쪽으로 넘긴다.
  let meta: BoardMeta | undefined;
  if (input.name !== undefined || input.description !== undefined) {
    const name = input.name?.trim();
    if (input.name !== undefined && (!name || name.length > 120))
      throw new ProjectRegistryError(400, "invalid_project_name");
    const patched = await client.kanban.updateBoard(board.boardSlug, {
      ...(name === undefined ? {} : { name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    if (!patched.ok)
      throw new ProjectRegistryError(503, patched.failure.code, patched.failure.message);
    meta = patched.data.board;
  }

  const patch: Partial<ProjectRow> = { updatedAt: nowForDb() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.leadNpcId !== undefined) patch.leadNpcId = input.leadNpcId;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
  if (input.color !== undefined) patch.color = input.color;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.pauseReason !== undefined) patch.pauseReason = input.pauseReason;

  const [updated] = await db
    .update(channelProjects)
    .set(patch)
    .where(eq(channelProjects.id, project.id))
    .returning();

  if (!meta) {
    const listed = await client.kanban.listBoards();
    if (listed.ok) meta = listed.data.boards.find((b) => b.slug === board.boardSlug);
  }
  return viewOf(board, updated, meta);
}

/**
 * 보관 — Hermes 에 보드 삭제·보관 라우트가 없으므로(플러그인 `routes.py` 는 GET/POST/PATCH 뿐)
 * **우리 쪽 상태 전이**다. 연결 행과 Hermes 보드는 남고 폴링도 계속한다. 보관된 프로젝트의 카드가
 * 아직 돌고 있을 수 있어서이고, 조용히 멈추면 "성공을 보고하면서 아무것도 안 함" 이 된다.
 *
 * 사건 수신 보드를 보관하면 다른 활성 보드로 그 자리를 옮긴다. **옮긴 행의 커서는 그대로 둔다.**
 *
 * 처음엔 버렸는데, 플러그인을 읽어 보니 버릴 이유가 없고 버리면 손해였다(2026-09-21 정정).
 * - `k`(그 보드의 칸반 위치)는 그 행이 폴링해 온 진짜 위치다. 버리면 그 보드의 카드 사건을
 *   한 구간 통째로 놓친다 — 바로 그 "화면은 멀쩡한데 카드만 안 움직이는" 실패다.
 * - `c`(크론)는 비-carrier 행의 커서에도 **있다**. 플러그인의 `collect` 는 `include` 와 무관하게
 *   늘 `cron_tail` 을 돌려 `c` 를 전진시킨다(우리가 그 사건을 버렸을 뿐이다).
 * - `a`(아티팩트)만 없는데, 플러그인이 그 경우를 안전하게 다룬다. `artifact_position` 은 커서에
 *   `a` 키가 없으면 **지금 max(id)** 를 돌려준다(`events.py:663-673`, "과거 사건을 폭포처럼 다시
 *   주지 않는다"). 그래서 승격 뒤 첫 `include=artifacts` 호출이 과거를 재생하지 않는다.
 *
 * 자가 복구(`ensureChannelCarrier`)도 같은 이유로 커서를 유지한다 — 두 경로가 같은 규칙이다.
 */
export async function archiveChannelProject(
  channelId: string,
  projectId: string,
  status: "completed" | "cancelled",
): Promise<{ project: ProjectRow; carrierMovedTo: string | null }> {
  const project = await readProject(channelId, projectId);
  const board = await readProjectBoard(project);

  const boards = await listChannelBoards(channelId);
  const projects = new Map<string, ProjectRow>();
  for (const row of boards) projects.set(row.id, await ensureProjectRow(row));

  const stillActive = boards.filter(
    (row) => row.id !== board.id && !ARCHIVED_STATUSES.has(projects.get(row.id)?.status ?? ""),
  );
  if (stillActive.length === 0) throw new ProjectRegistryError(400, "last_board");

  let carrierMovedTo: string | null = null;
  if (board.isEventCarrier) {
    const next = stillActive[0];
    const now = nowForDb();
    // 순서가 중요하다 — 부분 유니크가 carrier 둘을 거절하므로 먼저 내려놓고 올린다.
    // 이 레포에서는 트랜잭션으로 묶을 수 없다: better-sqlite3 드라이버가 동기라
    // `db.transaction` 이 async 콜백을 `Transaction function cannot return a promise` 로 거절한다.
    // 그래서 두 겹으로 막는다.
    //   1) 여기 보상 — 올리기가 실패하면 내려놓은 것을 되돌린다.
    //   2) `ensureChannelCarrier` 자가 복구 — 두 UPDATE **사이에 죽은** 경우는 보상으로 못 막고
    //      읽는 쪽이 고친다. carrier 0개는 부분 유니크가 막아 주지 않는다.
    await db
      .update(channelKanbanBoards)
      .set({ isEventCarrier: false, updatedAt: now })
      .where(eq(channelKanbanBoards.id, board.id));
    try {
      await db
        .update(channelKanbanBoards)
        .set({ isEventCarrier: true, updatedAt: now })
        .where(eq(channelKanbanBoards.id, next.id));
    } catch (err) {
      await db
        .update(channelKanbanBoards)
        .set({ isEventCarrier: true, updatedAt: nowForDb() })
        .where(eq(channelKanbanBoards.id, board.id));
      throw err;
    }
    carrierMovedTo = next.boardSlug;
  }

  const [updated] = await db
    .update(channelProjects)
    .set({ status, updatedAt: nowForDb() })
    .where(eq(channelProjects.id, project.id))
    .returning();
  return { project: updated, carrierMovedTo };
}

// ---------------------------------------------------------------------------
// 서브프로젝트
// ---------------------------------------------------------------------------

function resolveSubprojectSlug(input: { tenantSlug?: string; name: string; description?: string }) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ProjectRegistryError(400, "invalid_subproject_name");
  const slug = input.tenantSlug?.trim() ? input.tenantSlug.trim() : tenantSlugFromName(name);
  if (!slug) {
    // 이름에 글자·숫자가 하나도 없었다. 형식 위반과 갈라야 화면이 정확히 안내한다.
    throw new ProjectRegistryError(400, "tenant_slug_underivable");
  }
  if (!isTenantSlug(slug)) throw new ProjectRegistryError(400, "invalid_tenant_slug");
  return { tenantSlug: slug, name, description: input.description };
}

function assertUniqueSlugs(slugs: string[]) {
  if (new Set(slugs).size !== slugs.length)
    throw new ProjectRegistryError(409, "subproject_exists");
}

async function insertSubproject(
  projectId: string,
  sub: { tenantSlug: string; name: string; description?: string },
  originMeetingId: string | null,
): Promise<SubprojectRow> {
  const now = nowForDb();
  try {
    const [row] = await db
      .insert(channelSubprojects)
      .values({
        projectId,
        tenantSlug: sub.tenantSlug,
        name: sub.name,
        description: sub.description ?? null,
        originMeetingId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  } catch {
    // `(project_id, tenant_slug)` 유니크. 같은 슬러그를 두 번 등록하려 한 것이다.
    throw new ProjectRegistryError(409, "subproject_exists");
  }
}

export type SubprojectView = SubprojectRow & {
  /** 이 슬러그를 쓰는 카드가 보드에 실제로 있는가. 메타만 있고 카드가 없을 수 있다. */
  observed: boolean;
};

/**
 * 서브프로젝트 목록. 등록된 메타와 **보드에서 관측된 테넌트**를 왼쪽 조인한다.
 *
 * DeskRPG 밖(Hermes CLI·다른 도구)에서 만든 카드가 모르는 `tenant` 값을 들고 올 수 있다.
 * 그런 값을 조용히 숨기면 사용자는 카드가 어디로 갔는지 알 수 없다 — 슬러그를 이름 삼아
 * `registered: false` 로 싣는다.
 */
export async function listSubprojects(
  project: ProjectRow,
  board: ChannelBoardRow,
  client: OwnerPluginClient,
): Promise<{ registered: SubprojectView[]; unregistered: string[] }> {
  const rows = await db
    .select()
    .from(channelSubprojects)
    .where(eq(channelSubprojects.projectId, project.id))
    .orderBy(channelSubprojects.createdAt);

  const view = await client.kanban.getBoard(board.boardSlug, { includeArchived: true });
  const observed = new Set<string>(view.ok ? (view.data.tenants ?? []) : []);
  const known = new Set(rows.map((r) => r.tenantSlug));

  return {
    registered: rows.map((row) => ({ ...row, observed: observed.has(row.tenantSlug) })),
    unregistered: [...observed].filter((slug) => !known.has(slug)).sort(),
  };
}

export async function createSubproject(
  project: ProjectRow,
  input: {
    tenantSlug?: string;
    name: string;
    description?: string;
    originMeetingId?: string | null;
  },
): Promise<SubprojectRow> {
  const sub = resolveSubprojectSlug(input);
  return insertSubproject(project.id, sub, input.originMeetingId ?? null);
}

export type UpdateSubprojectInput = {
  name?: string;
  description?: string | null;
  status?: string;
  leadNpcId?: string | null;
  targetDate?: string | null;
  color?: string | null;
  icon?: string | null;
  pauseReason?: string | null;
};

/** 슬러그는 받지 않는다 — Hermes 카드가 그 문자열을 들고 있어서 바꾸면 카드가 고아가 된다. */
export async function updateSubproject(
  projectId: string,
  subprojectId: string,
  input: UpdateSubprojectInput,
): Promise<SubprojectRow> {
  const [row] = await db
    .select()
    .from(channelSubprojects)
    .where(
      and(eq(channelSubprojects.id, subprojectId), eq(channelSubprojects.projectId, projectId)),
    )
    .limit(1);
  if (!row) throw new ProjectRegistryError(404, "subproject_not_found");

  if (input.status !== undefined && !isProjectStatus(input.status))
    throw new ProjectRegistryError(400, "invalid_project_status");

  const patch: Partial<SubprojectRow> = { updatedAt: nowForDb() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 120) throw new ProjectRegistryError(400, "invalid_subproject_name");
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (input.leadNpcId !== undefined) patch.leadNpcId = input.leadNpcId;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
  if (input.color !== undefined) patch.color = input.color;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.pauseReason !== undefined) patch.pauseReason = input.pauseReason;

  const [updated] = await db
    .update(channelSubprojects)
    .set(patch)
    .where(eq(channelSubprojects.id, row.id))
    .returning();
  return updated;
}

/** 채널의 NPC 인지 확인한다 — 리드 직원은 그 채널에 출근한 NPC 만 될 수 있다. */
export async function assertChannelNpc(channelId: string, npcId: string | null | undefined) {
  if (!npcId) return;
  const [row] = await db
    .select({ id: npcs.id })
    .from(npcs)
    .where(and(eq(npcs.id, npcId), eq(npcs.channelId, channelId)))
    .limit(1);
  if (!row) throw new ProjectRegistryError(400, "lead_npc_not_in_channel");
}
