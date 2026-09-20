/**
 * 프로젝트 목록표 REST (`/api/channels/:id/projects/**`).
 *
 * 얇은 핸들러다 — 판단은 `project-registry.ts`, 게이트는 `kanban-access.ts` 가 한다. 게이트를
 * 칸반과 공유하는 이유는 프로젝트가 곧 보드라서다: 게이트웨이가 없거나 플러그인이 낡았으면
 * 프로젝트 목록도 의미가 없다.
 *
 * 권한은 칸반의 층을 그대로 따른다 — **보기는 채널 멤버, 구조 변경은 채널 소유자**.
 * 게이트웨이 리소스 소유자 권한은 쓰지 않는다(호스트 운영 설정이 아니다).
 */

import { NextResponse, type NextRequest } from "next/server";

import { cronError } from "@/lib/cron-access";
import { getUserId } from "@/lib/internal-rpc";
import {
  archiveChannelProject,
  assertChannelNpc,
  createChannelProject,
  createSubproject,
  listChannelProjects,
  listSubprojects,
  ProjectRegistryError,
  readProject,
  readProjectBoard,
  updateChannelProject,
  updateSubproject,
  type SubprojectRow,
} from "@/lib/project-registry";
import { resolveKanbanChannelContext, type KanbanChannelContext } from "@/lib/kanban-access";

export type ChannelParams = {
  params: Promise<{ id: string; projectId?: string; subprojectId?: string }>;
};

function failure(err: unknown): NextResponse {
  if (err instanceof ProjectRegistryError) return cronError(err.status, err.code, err.message);
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(`[project-routes] unexpected failure: ${reason}`);
  return cronError(500, "internal_error", "internal error");
}

async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 게이트를 한 번 통과한 컨텍스트. 보드는 명시하지 않는다 — 프로젝트는 보드 목록 전체를 다룬다. */
async function resolve(req: NextRequest, channelId: string) {
  return resolveKanbanChannelContext({ userId: getUserId(req), channelId });
}

function requireOwner(ctx: KanbanChannelContext): NextResponse | null {
  return ctx.isChannelOwner ? null : cronError(403, "forbidden", "channel owner required");
}

function subprojectPayload(row: SubprojectRow) {
  return {
    id: row.id,
    tenantSlug: row.tenantSlug,
    name: row.name,
    description: row.description,
    status: row.status,
    leadNpcId: row.leadNpcId,
    targetDate: row.targetDate,
    color: row.color,
    icon: row.icon,
    pauseReason: row.pauseReason,
    originMeetingId: row.originMeetingId,
  };
}

function optionalString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new ProjectRegistryError(400, "invalid_body", `${key}`);
  return value;
}

// ---------------------------------------------------------------------------
// /projects
// ---------------------------------------------------------------------------

export async function listProjects(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  try {
    return NextResponse.json({
      projects: await listChannelProjects(channelId, resolved.ctx.client),
    });
  } catch (err) {
    return failure(err);
  }
}

export async function postProject(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  if (typeof body.name !== "string") return cronError(400, "invalid_body", "name is required");

  try {
    const leadNpcId = optionalString(body, "leadNpcId");
    await assertChannelNpc(channelId, leadNpcId);
    const subprojects = Array.isArray(body.subprojects)
      ? (body.subprojects as { tenantSlug?: string; name: string; description?: string }[])
      : undefined;
    const created = await createChannelProject(channelId, resolved.ctx.client, {
      name: body.name,
      description: optionalString(body, "description") ?? undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      leadNpcId,
      targetDate: optionalString(body, "targetDate"),
      color: optionalString(body, "color"),
      icon: optionalString(body, "icon"),
      originMeetingId: optionalString(body, "originMeetingId"),
      createdByUserId: resolved.ctx.userId,
      subprojects,
    });
    return NextResponse.json(
      { project: created.project, subprojects: created.subprojects.map(subprojectPayload) },
      { status: 201 },
    );
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------
// /projects/:projectId
// ---------------------------------------------------------------------------

export async function getProject(req: NextRequest, channelId: string, projectId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  try {
    const project = await readProject(channelId, projectId);
    const board = await readProjectBoard(project);
    const subprojects = await listSubprojects(project, board, resolved.ctx.client);
    const projects = await listChannelProjects(channelId, resolved.ctx.client);
    const view = projects.find((p) => p.id === project.id);
    return NextResponse.json({
      project: view ?? null,
      subprojects: subprojects.registered.map((row) => ({
        ...subprojectPayload(row),
        observed: row.observed,
      })),
      unregisteredTenants: subprojects.unregistered,
    });
  } catch (err) {
    return failure(err);
  }
}

export async function patchProject(req: NextRequest, channelId: string, projectId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  try {
    const leadNpcId = optionalString(body, "leadNpcId");
    await assertChannelNpc(channelId, leadNpcId);
    const view = await updateChannelProject(channelId, projectId, resolved.ctx.client, {
      name: optionalString(body, "name") ?? undefined,
      description: optionalString(body, "description") ?? undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      leadNpcId,
      targetDate: optionalString(body, "targetDate"),
      color: optionalString(body, "color"),
      icon: optionalString(body, "icon"),
      pauseReason: optionalString(body, "pauseReason"),
    });
    return NextResponse.json({ project: view });
  } catch (err) {
    return failure(err);
  }
}

export async function postProjectArchive(req: NextRequest, channelId: string, projectId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = (await readJsonBody(req)) ?? {};
  const status = body.status === "cancelled" ? "cancelled" : "completed";
  try {
    const result = await archiveChannelProject(channelId, projectId, status);
    return NextResponse.json({
      project: { id: result.project.id, status: result.project.status },
      carrierMovedTo: result.carrierMovedTo,
    });
  } catch (err) {
    return failure(err);
  }
}

// ---------------------------------------------------------------------------
// /projects/:projectId/subprojects
// ---------------------------------------------------------------------------

export async function listProjectSubprojects(
  req: NextRequest,
  channelId: string,
  projectId: string,
) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  try {
    const project = await readProject(channelId, projectId);
    const board = await readProjectBoard(project);
    const result = await listSubprojects(project, board, resolved.ctx.client);
    return NextResponse.json({
      subprojects: result.registered.map((row) => ({
        ...subprojectPayload(row),
        observed: row.observed,
      })),
      unregisteredTenants: result.unregistered,
    });
  } catch (err) {
    return failure(err);
  }
}

export async function postSubproject(req: NextRequest, channelId: string, projectId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  if (typeof body.name !== "string") return cronError(400, "invalid_body", "name is required");
  try {
    const project = await readProject(channelId, projectId);
    const row = await createSubproject(project, {
      tenantSlug: typeof body.tenantSlug === "string" ? body.tenantSlug : undefined,
      name: body.name,
      description: optionalString(body, "description") ?? undefined,
      originMeetingId: optionalString(body, "originMeetingId"),
    });
    return NextResponse.json({ subproject: subprojectPayload(row) }, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}

export async function patchSubproject(
  req: NextRequest,
  channelId: string,
  projectId: string,
  subprojectId: string,
) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = await readJsonBody(req);
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  try {
    const project = await readProject(channelId, projectId);
    const leadNpcId = optionalString(body, "leadNpcId");
    await assertChannelNpc(channelId, leadNpcId);
    const row = await updateSubproject(project.id, subprojectId, {
      name: optionalString(body, "name") ?? undefined,
      description: optionalString(body, "description"),
      status: typeof body.status === "string" ? body.status : undefined,
      leadNpcId,
      targetDate: optionalString(body, "targetDate"),
      color: optionalString(body, "color"),
      icon: optionalString(body, "icon"),
      pauseReason: optionalString(body, "pauseReason"),
    });
    return NextResponse.json({ subproject: subprojectPayload(row) });
  } catch (err) {
    return failure(err);
  }
}

export async function postSubprojectArchive(
  req: NextRequest,
  channelId: string,
  projectId: string,
  subprojectId: string,
) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const denied = requireOwner(resolved.ctx);
  if (denied) return denied;

  const body = (await readJsonBody(req)) ?? {};
  const status = body.status === "cancelled" ? "cancelled" : "completed";
  try {
    const project = await readProject(channelId, projectId);
    const row = await updateSubproject(project.id, subprojectId, { status });
    return NextResponse.json({ subproject: subprojectPayload(row) });
  } catch (err) {
    return failure(err);
  }
}
