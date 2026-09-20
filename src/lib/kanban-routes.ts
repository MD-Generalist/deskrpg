/**
 * 칸반 REST 라우트 핸들러들이 공유하는 몸통.
 *
 * 라우트 파일(`src/app/api/channels/[id]/kanban/**`)은 얇게 두고 — 본문 파싱, 문지기
 * (`kanban-access.ts`), Hermes 호출, dispatch 한 번(R9), 즉시 폴링(R24), 응답 조립 — 의
 * 순서를 여기 한 곳에 고정한다.
 *
 * Hermes 가 정본이다. 카드 상태는 재해석하지 않고(R6) 응답을 그대로 전달하며, Hermes 오류는
 * 상태 코드와 `{code, message}` 그대로 내려간다(R32). 여기서 우리가 정하는 것은 권한과
 * 담당자 검증뿐이다.
 */

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { db, gatewayResources } from "@/db";
import { schedulePollNow } from "@/lib/automation-poll-trigger";
import { readWorkingSnapshot } from "@/lib/automation-registry";
import {
  cronError,
  ensureAutomationPlugin,
  pluginFailureResponse,
  requireChannelMember,
} from "@/lib/cron-access";
import { getChannelGatewayBinding } from "@/lib/gateway-resources";
import type {
  CreateTaskBody,
  KanbanTaskAction,
  UpdateOrchestrationBody,
  UpdateTaskBody,
  WorkspaceKind,
} from "@/lib/hermes/deskrpg-plugin-types";
import { restorePluginInfo } from "@/lib/hermes/plugin-cache-update";
import { swarmGate } from "@/lib/hermes/plugin-capability";
import type { KanbanTaskActionInput } from "@/lib/hermes/plugin-client-types";
import { pluginUpgradeRequired } from "@/lib/hermes/plugin-errors";
import { rawFailureResponse, streamProxyResponse } from "@/lib/hermes/stream-proxy";
import { getUserId } from "@/lib/internal-rpc";
import {
  AUTOMATION_MIN_PLUGIN_VERSION,
  attachmentsUnsupportedResponse,
  commentAuthorFor,
  loadChannelRoster,
  resolveAssignee,
  resolveKanbanChannelContext,
  supportsAttachments,
  type KanbanChannelContext,
} from "@/lib/kanban-access";
import { channelBoardSlug, getChannelBoard } from "@/lib/kanban-boards";
import { getMyCharacter } from "@/lib/my-character";
import { appendRequesterLine } from "@/lib/user-context";

export type ChannelParams = { params: Promise<{ id: string }> };
export type TaskParams = { params: Promise<{ id: string; taskId: string }> };
export type AttachmentParams = { params: Promise<{ id: string; attachmentId: string }> };

// ---------------------------------------------------------------------------
// 본문·쿼리
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>;

/** JSON 본문. 비어 있거나 깨졌으면 null — 호출부가 400 을 낸다. */
async function readJsonBody(req: NextRequest): Promise<JsonBody | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonBody)
      : null;
  } catch {
    return null;
  }
}

/** 본문이 없어도 되는 액션(approve·reclaim 등)용 — 비어 있으면 빈 객체. */
async function readOptionalJsonBody(req: NextRequest): Promise<JsonBody> {
  return (await readJsonBody(req)) ?? {};
}

function invalidBody(message: string) {
  return cronError(400, "invalid_body", message);
}

const WORKSPACE_KINDS: readonly WorkspaceKind[] = ["scratch", "worktree", "dir"];

function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return typeof value === "string" && (WORKSPACE_KINDS as readonly string[]).includes(value);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : undefined;
}

/** 문자열 필드만 골라 담는다. 모르는 키는 버린다 — Hermes 로 나가는 본문에 섞이면 안 된다. */
const TASK_STRING_FIELDS = [
  "body",
  "tenant",
  "priority",
  "workspace_path",
  "model_override",
  "provider_override",
  "reasoning_effort",
  "project_id",
] as const;
const TASK_NUMBER_FIELDS = ["max_runtime_seconds", "goal_max_turns"] as const;

function pickTaskFields(body: JsonBody): Omit<CreateTaskBody, "title" | "assignee"> {
  const out: Omit<CreateTaskBody, "title" | "assignee"> = {};
  for (const key of TASK_STRING_FIELDS) {
    if (typeof body[key] === "string") out[key] = body[key] as string;
  }
  for (const key of TASK_NUMBER_FIELDS) {
    if (typeof body[key] === "number" && Number.isFinite(body[key] as number)) {
      out[key] = body[key] as number;
    }
  }
  if (isWorkspaceKind(body.workspace_kind)) out.workspace_kind = body.workspace_kind;
  const parents = stringList(body.parents);
  if (parents) out.parents = parents;
  const skills = stringList(body.skills);
  if (skills) out.skills = skills;
  if (typeof body.goal_mode === "boolean") out.goal_mode = body.goal_mode;
  if (typeof body.triage === "boolean") out.triage = body.triage;
  return out;
}

/**
 * 담당자 필드. `assignee` 는 npcId 로 받는다(R8) — 서버가 profile_name 으로 바꾼다.
 * `null` 은 "담당 해제" 로 그대로 넘긴다(PATCH 전용).
 */
async function resolveAssigneeField(
  ctx: KanbanChannelContext,
  body: JsonBody,
): Promise<{ ok: true; assignee?: string | null } | { ok: false; response: NextResponse }> {
  if (!("assignee" in body)) return { ok: true };
  if (body.assignee === null) return { ok: true, assignee: null };
  if (typeof body.assignee !== "string" || !body.assignee) {
    return { ok: false, response: invalidBody("assignee must be an npcId") };
  }
  const resolved = await resolveAssignee(ctx, body.assignee);
  if (!resolved.ok) return resolved;
  return { ok: true, assignee: resolved.profileName };
}

// ---------------------------------------------------------------------------
// 공통 흐름
// ---------------------------------------------------------------------------

/**
 * 요청이 가리키는 보드. `?board=` 가 없으면 undefined 이고, 그러면 컨텍스트가 그 채널의
 * 사건 수신 보드를 쓴다 — 보드를 모르는 옛 클라이언트의 뜻이 바뀌지 않게 하는 지점이다.
 *
 * 형식 검사만 여기서 한다. **이 채널의 보드인지**는 `kanban-access` 가 404 로 판정한다 —
 * 형식이 맞는 남의 보드 slug 를 형식 검사로는 걸러낼 수 없기 때문이다.
 */
function requestedBoardSlug(req: NextRequest): string | undefined | null {
  const raw = req.nextUrl.searchParams.get("board");
  if (raw === null || raw === "") return undefined;
  return BOARD_SLUG.test(raw) ? raw : null;
}

/** 플러그인의 보드 slug 규칙과 같다(`BOARD_SLUG_RE`). */
const BOARD_SLUG = /^[a-z0-9-]{1,64}$/;

async function resolve(req: NextRequest, channelId: string) {
  const boardSlug = requestedBoardSlug(req);
  if (boardSlug === null) {
    return {
      ok: false as const,
      response: cronError(400, "invalid_board", "board slug is malformed"),
    };
  }
  return resolveKanbanChannelContext({ userId: getUserId(req), channelId, boardSlug });
}

/** R9. 생성·상태 변경 직후 dispatch 를 한 번 요청한다. 실패는 무시한다. */
async function dispatchOnce(ctx: KanbanChannelContext): Promise<void> {
  try {
    await ctx.client.kanban.dispatch(ctx.boardSlug);
  } catch {
    // 응답 경로에 섞지 않는다 — 다음 폴링·수동 dispatch 가 다시 시도한다.
  }
}

// ---------------------------------------------------------------------------
// 보드·카드
// ---------------------------------------------------------------------------

export async function getBoard(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;
  const includeArchived = req.nextUrl.searchParams.get("include_archived") === "true";
  const [res, npcs] = await Promise.all([
    ctx.client.kanban.getBoard(ctx.boardSlug, { includeArchived }),
    loadChannelRoster(ctx),
  ]);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ ...res.data, npcs });
}

/**
 * `GET /api/channels/:id/kanban/links` — 보드 전체의 부모·자식 쌍.
 *
 * 플러그인에 묶음 조회가 없으면 404 가 그대로 올라간다. 화면은 그때 카드마다 상세를 부르는
 * 길로 내려앉는다 — 여기서 빈 목록으로 덮으면 "링크가 없다" 와 "물어볼 수 없다" 가 같아진다.
 */
export async function listLinks(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const res = await resolved.ctx.client.kanban.listLinks(resolved.ctx.boardSlug);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

/**
 * `GET /api/channels/:id/kanban/runs?from=&to=&limit=` — 창 안의 실행 기록.
 *
 * 쿼리는 그대로 넘긴다. 검증은 플러그인이 하고(400 `invalid_query`), 여기서 한 번 더 하면
 * 두 곳의 규칙이 갈린다. 숫자가 아닌 값은 넘기지 않아 플러그인의 판정을 받게 한다.
 */
export async function listRuns(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const q = req.nextUrl.searchParams;
  const num = (key: string) => {
    const raw = q.get(key);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
  };
  const res = await resolved.ctx.client.kanban.listRuns(resolved.ctx.boardSlug, {
    from: num("from"),
    to: num("to"),
    limit: num("limit"),
  });
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

export async function getTask(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const res = await resolved.ctx.client.kanban.getTask(resolved.ctx.boardSlug, taskId);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

export async function createTask(req: NextRequest, channelId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return invalidBody("title is required");

  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  const assignee = await resolveAssigneeField(ctx, body);
  if (!assignee.ok) return assignee.response;

  const task: CreateTaskBody = {
    title,
    ...pickTaskFields(body),
    ...(typeof assignee.assignee === "string" ? { assignee: assignee.assignee } : {}),
  };
  // 누가 시켰는지를 카드 본문 끝에 남긴다. 캐릭터가 없으면 붙이지 않고 그대로 만든다.
  const mine = await getMyCharacter(ctx.userId);
  if (mine) task.body = appendRequesterLine(task.body, { name: mine.name, bio: mine.bio });
  const res = await ctx.client.kanban.createTask(ctx.boardSlug, task);
  if (!res.ok) return pluginFailureResponse(res);

  await dispatchOnce(ctx);
  schedulePollNow(ctx.channelId);
  return NextResponse.json(
    { task: res.data.task, ...(res.data.warning ? { warning: res.data.warning } : {}) },
    { status: 201 },
  );
}

export async function updateTask(req: NextRequest, channelId: string, taskId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");

  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  const assignee = await resolveAssigneeField(ctx, body);
  if (!assignee.ok) return assignee.response;

  const update: UpdateTaskBody = { ...pickTaskFields(body) };
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim();
  // 상태 값은 검증하지 않는다(R6) — Hermes 가 400 으로 답하면 그대로 전달한다.
  if (typeof body.status === "string") update.status = body.status as UpdateTaskBody["status"];
  if (assignee.assignee !== undefined) {
    update.assignee = (assignee.assignee ?? undefined) as UpdateTaskBody["assignee"];
  }

  const res = await ctx.client.kanban.updateTask(ctx.boardSlug, taskId, update);
  if (!res.ok) return pluginFailureResponse(res);

  if (update.status !== undefined) await dispatchOnce(ctx);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ task: res.data.task });
}

export async function deleteTask(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;
  const res = await ctx.client.kanban.deleteTask(ctx.boardSlug, taskId);
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ ok: true });
}

export async function addComment(req: NextRequest, channelId: string, taskId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) return invalidBody("body is required");

  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  const res = await ctx.client.kanban.addComment(ctx.boardSlug, taskId, {
    author: await commentAuthorFor(ctx.userId),
    body: text,
  });
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ comment: res.data.comment }, { status: 201 });
}

// ---------------------------------------------------------------------------
// 카드 액션 (R10·R13)
// ---------------------------------------------------------------------------

/** 상태를 바꾸는 액션 — 성공 직후 dispatch 를 한 번 요청한다(R9). */
const DISPATCH_AFTER: ReadonlySet<KanbanTaskAction> = new Set<KanbanTaskAction>([
  "approve",
  "request-changes",
  "unblock",
  "reassign",
  "reclaim",
]);

export async function runTaskAction(
  req: NextRequest,
  channelId: string,
  taskId: string,
  action: KanbanTaskAction,
) {
  const body = await readOptionalJsonBody(req);
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  let res;
  switch (action) {
    case "reassign": {
      const npcId = typeof body.npcId === "string" ? body.npcId : "";
      if (!npcId) return invalidBody("npcId is required");
      const assignee = await resolveAssignee(ctx, npcId);
      if (!assignee.ok) return assignee.response;
      const input: KanbanTaskActionInput<"reassign"> = {
        profile: assignee.profileName,
        reclaim_first: true,
      };
      res = await ctx.client.kanban.runTaskAction(ctx.boardSlug, taskId, "reassign", input);
      break;
    }
    case "request-changes": {
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      if (!comment) return invalidBody("comment is required");
      res = await ctx.client.kanban.runTaskAction(ctx.boardSlug, taskId, "request-changes", {
        comment,
      });
      break;
    }
    case "unblock": {
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      res = await ctx.client.kanban.runTaskAction(
        ctx.boardSlug,
        taskId,
        "unblock",
        comment ? { comment } : {},
      );
      break;
    }
    default:
      res = await ctx.client.kanban.runTaskAction(ctx.boardSlug, taskId, action, {});
  }
  if (!res.ok) return pluginFailureResponse(res);

  if (DISPATCH_AFTER.has(action)) await dispatchOnce(ctx);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ task: res.data.task });
}

// ---------------------------------------------------------------------------
// 첨부 (R12)
// ---------------------------------------------------------------------------

async function resolveForAttachments(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved;
  if (!supportsAttachments(resolved.ctx)) {
    return { ok: false as const, response: attachmentsUnsupportedResponse() };
  }
  return resolved;
}

export async function listAttachments(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolveForAttachments(req, channelId);
  if (!resolved.ok) return resolved.response;
  const res = await resolved.ctx.client.kanban.listAttachments(resolved.ctx.boardSlug, taskId);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ attachments: res.data.attachments });
}

/** multipart 의 `file` 파트를 그대로 Hermes 로 넘긴다. */
export async function uploadAttachment(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolveForAttachments(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  let file: File | null = null;
  try {
    const form = await req.formData();
    const part = form.get("file");
    if (part instanceof File) file = part;
  } catch {
    file = null;
  }
  if (!file) return invalidBody("multipart field 'file' is required");

  const res = await ctx.client.kanban.uploadAttachment(ctx.boardSlug, taskId, {
    filename: file.name || "attachment",
    content: file,
  });
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ attachment: res.data.attachment }, { status: 201 });
}

/** 첨부 id 모양. `.`·`..`·`/` 는 URL 정규화로 소유자 토큰이 다른 경로에 닿게 한다 — 부르기 전에 막는다. */
const ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function attachmentNotFound() {
  return cronError(404, "attachment_not_found", "attachment not found");
}

export async function getAttachment(req: NextRequest, channelId: string, attachmentId: string) {
  const resolved = await resolveForAttachments(req, channelId);
  if (!resolved.ok) return resolved.response;
  if (!ATTACHMENT_ID_RE.test(attachmentId)) return attachmentNotFound();
  const res = await resolved.ctx.client.kanban.attachmentContent(
    resolved.ctx.boardSlug,
    attachmentId,
    { range: req.headers.get("range") },
  );
  if (!res.ok) return rawFailureResponse(res);
  return streamProxyResponse(res.response, { forceAttachment: true });
}

export async function deleteAttachment(req: NextRequest, channelId: string, attachmentId: string) {
  const resolved = await resolveForAttachments(req, channelId);
  if (!resolved.ok) return resolved.response;
  if (!ATTACHMENT_ID_RE.test(attachmentId)) return attachmentNotFound();
  const ctx = resolved.ctx;
  const res = await ctx.client.kanban.deleteAttachment(ctx.boardSlug, attachmentId);
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// 링크 (R14) · dispatch · 로그
// ---------------------------------------------------------------------------

export async function mutateLink(req: NextRequest, channelId: string, op: "add" | "remove") {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const parentId = typeof body.parent_id === "string" ? body.parent_id : "";
  const childId = typeof body.child_id === "string" ? body.child_id : "";
  if (!parentId || !childId) return invalidBody("parent_id and child_id are required");

  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;
  const link = { parent_id: parentId, child_id: childId };
  const res =
    op === "add"
      ? await ctx.client.kanban.addLink(ctx.boardSlug, link)
      : await ctx.client.kanban.removeLink(ctx.boardSlug, link);
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ ok: true });
}

export async function dispatchBoard(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;
  const rawMax = Number(req.nextUrl.searchParams.get("max"));
  const max = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : undefined;
  const res = await ctx.client.kanban.dispatch(
    ctx.boardSlug,
    max !== undefined ? { max } : undefined,
  );
  if (!res.ok) return pluginFailureResponse(res);
  schedulePollNow(ctx.channelId);
  return NextResponse.json(res.data);
}

// ---------------------------------------------------------------------------
// 스웜 — Hermes `create_swarm` 으로 가는 경로. 토폴로지는 Hermes 가 만든다.
// ---------------------------------------------------------------------------

type SwarmWorkerInput = { npcId: string; title: string; body?: string; skills?: string[] };

function parseSwarmWorkers(raw: unknown): SwarmWorkerInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SwarmWorkerInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.npcId !== "string" || !record.npcId) return null;
    if (typeof record.title !== "string" || !record.title.trim()) return null;
    out.push({
      npcId: record.npcId,
      title: record.title.trim(),
      body: typeof record.body === "string" ? record.body : undefined,
      skills: stringList(record.skills),
    });
  }
  return out;
}

export async function createSwarm(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  // 능력 판정이 먼저다. NPC 를 다 풀어 놓고 404 를 받으면 사용자가 원인을 못 본다.
  const gate = swarmGate(ctx.info);
  if (!gate.ok) {
    const failure = pluginUpgradeRequired(gate);
    return cronError(428, failure.code, failure.message, failure.details);
  }

  const body = await readJsonBody(req);
  if (!body) return invalidBody("body must be a JSON object");

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return invalidBody("goal is required");

  const workers = parseSwarmWorkers(body.workers);
  if (!workers) return invalidBody("workers must be a non-empty array of {npcId, title}");

  if (typeof body.verifierNpcId !== "string" || !body.verifierNpcId) {
    return invalidBody("verifierNpcId must be an npcId");
  }
  if (typeof body.synthesizerNpcId !== "string" || !body.synthesizerNpcId) {
    return invalidBody("synthesizerNpcId must be an npcId");
  }

  // 전부 풀고 나서 보낸다. 하나라도 실패하면 아무것도 만들지 않는다 — 부분 생성은
  // 반쯤 연결된 그래프를 남기고, 그걸 디스패처가 본다.
  const workerProfiles: string[] = [];
  for (const worker of workers) {
    const r = await resolveAssignee(ctx, worker.npcId);
    if (!r.ok) return r.response;
    workerProfiles.push(r.profileName);
  }
  const verifier = await resolveAssignee(ctx, body.verifierNpcId);
  if (!verifier.ok) return verifier.response;
  const synthesizer = await resolveAssignee(ctx, body.synthesizerNpcId);
  if (!synthesizer.ok) return synthesizer.response;

  const res = await ctx.client.kanban.createSwarm(ctx.boardSlug, {
    goal,
    workers: workers.map((worker, index) => ({
      profile: workerProfiles[index],
      title: worker.title,
      ...(worker.body ? { body: worker.body } : {}),
      ...(worker.skills ? { skills: worker.skills } : {}),
    })),
    verifier: verifier.profileName,
    synthesizer: synthesizer.profileName,
    ...(typeof body.idempotencyKey === "string" ? { idempotency_key: body.idempotencyKey } : {}),
  });
  if (!res.ok) return pluginFailureResponse(res);

  // R9 와 같다 — 만들자마자 한 틱 돌려 워커가 60초를 기다리지 않게 한다.
  await dispatchOnce(ctx);
  schedulePollNow(ctx.channelId);
  return NextResponse.json(res.data);
}

export async function getBlackboard(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  // createSwarm 과 같은 게이트 — 블랙보드도 스웜 기능이므로 같은 428 을 낸다.
  const gate = swarmGate(ctx.info);
  if (!gate.ok) {
    const failure = pluginUpgradeRequired(gate);
    return cronError(428, failure.code, failure.message, failure.details);
  }

  const res = await ctx.client.kanban.getBlackboard(ctx.boardSlug, taskId);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

export async function getTaskLog(req: NextRequest, channelId: string, taskId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const rawTail = Number(req.nextUrl.searchParams.get("tail"));
  const tail = Number.isInteger(rawTail) && rawTail >= 0 ? rawTail : undefined;
  const res = await resolved.ctx.client.kanban.getTaskLog(resolved.ctx.boardSlug, taskId, {
    tail,
  });
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

// ---------------------------------------------------------------------------
// 설정 — 보드 작업 폴더(채널 소유자) · 호스트 운영 설정(읽기 = 채널 소유자, 수정 = 게이트웨이 소유자)
// ---------------------------------------------------------------------------

function settingsForbidden() {
  return cronError(403, "settings_forbidden", "You cannot change this setting");
}

async function readBoardMeta(ctx: KanbanChannelContext) {
  const res = await ctx.client.kanban.listBoards();
  if (!res.ok) return res;
  const meta = res.data.boards.find((b) => b.slug === ctx.boardSlug) ?? null;
  return { ok: true as const, data: meta };
}

async function buildSettingsResponse(ctx: KanbanChannelContext) {
  // 운영 설정 읽기는 채널 소유자의 권한이지만, 고칠 수 있는 게이트웨이 소유자가 자기가 고친
  // 값을 못 보는 모양은 성립하지 않는다 — 수정 권한은 읽기 권한을 함의한다. 일반 멤버는 null.
  const canReadOrchestration = ctx.isChannelOwner || ctx.isGatewayOwner;
  const [board, orchestration] = await Promise.all([
    readBoardMeta(ctx),
    canReadOrchestration ? ctx.client.kanban.getOrchestration() : Promise.resolve(null),
  ]);
  if (!board.ok) return pluginFailureResponse(board);
  if (orchestration && !orchestration.ok) return pluginFailureResponse(orchestration);
  return NextResponse.json({
    board: {
      slug: ctx.boardSlug,
      name: board.data?.name ?? null,
      default_workdir: board.data?.default_workdir ?? null,
      editable: ctx.isChannelOwner,
    },
    orchestration: orchestration ? { ...orchestration.data, editable: ctx.isGatewayOwner } : null,
    hints: { default_assignee_recommend_empty: true },
  });
}

export async function getSettings(req: NextRequest, channelId: string) {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  return buildSettingsResponse(resolved.ctx);
}

function parseOrchestrationPatch(raw: JsonBody): UpdateOrchestrationBody {
  const patch: UpdateOrchestrationBody = {};
  for (const key of ["orchestrator_profile", "default_assignee"] as const) {
    if (key in raw && (typeof raw[key] === "string" || raw[key] === null)) {
      patch[key] = raw[key] as string | null;
    }
  }
  if (typeof raw.auto_decompose === "boolean") patch.auto_decompose = raw.auto_decompose;
  for (const key of ["max_in_progress", "max_in_progress_per_profile"] as const) {
    if (typeof raw[key] === "number" && Number.isInteger(raw[key])) patch[key] = raw[key] as number;
  }
  return patch;
}

/** PATCH `{board?:{default_workdir}, orchestration?:{...}}`. 권한 없는 부분이 하나라도 있으면 403. */
export async function patchSettings(req: NextRequest, channelId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const boardPatch =
    typeof body.board === "object" && body.board !== null ? (body.board as JsonBody) : null;
  const orchestrationPatch =
    typeof body.orchestration === "object" && body.orchestration !== null
      ? (body.orchestration as JsonBody)
      : null;
  if (!boardPatch && !orchestrationPatch) {
    return invalidBody("board or orchestration is required");
  }

  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const ctx = resolved.ctx;

  // 권한은 Hermes 를 부르기 전에 한꺼번에 본다 — 반만 적용된 채 403 이 나가면 안 된다.
  if (boardPatch && !ctx.isChannelOwner) return settingsForbidden();
  if (orchestrationPatch && !ctx.isGatewayOwner) return settingsForbidden();

  if (boardPatch) {
    if (typeof boardPatch.default_workdir !== "string") {
      return invalidBody("board.default_workdir must be a string");
    }
    const res = await ctx.client.kanban.updateBoard(ctx.boardSlug, {
      default_workdir: boardPatch.default_workdir,
    });
    if (!res.ok) return pluginFailureResponse(res);
  }
  if (orchestrationPatch) {
    const res = await ctx.client.kanban.updateOrchestration(
      parseOrchestrationPatch(orchestrationPatch),
    );
    if (!res.ok) return pluginFailureResponse(res);
  }
  return buildSettingsResponse(ctx);
}

// ---------------------------------------------------------------------------
// 자동화 상태 — 게이트를 통과하지 못해도 "왜" 를 보여 줘야 하므로 428·503 을 내지 않는다.
// ---------------------------------------------------------------------------

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getAutomationStatus(req: NextRequest, channelId: string) {
  const userId = getUserId(req);
  if (!userId) return cronError(401, "unauthorized", "unauthorized");
  const access = await requireChannelMember(channelId, userId);
  if (!access.ok) return access.response;

  const binding = await getChannelGatewayBinding(channelId);
  if (!binding) return cronError(409, "gateway_not_bound", "Channel has no gateway bound");

  // 캐시가 낡았으면 여기서 갱신된다. 판정 결과는 쓰지 않는다 — 상태는 캐시에서 읽는다.
  await ensureAutomationPlugin(binding.resource);
  const [gateway] = await db
    .select()
    .from(gatewayResources)
    .where(eq(gatewayResources.id, binding.resource.id))
    .limit(1);
  const info = restorePluginInfo(gateway?.pluginInfoJson);
  const boardRow = await getChannelBoard(channelId);

  return NextResponse.json({
    pluginStatus: gateway?.pluginStatus ?? null,
    pluginVersion: gateway?.pluginVersion ?? info?.version ?? null,
    capabilities: info?.capabilities ?? [],
    timezone: info?.timezone ?? null,
    boardSlug: boardRow?.boardSlug ?? channelBoardSlug(channelId),
    dispatcherPresent: info?.kanban.dispatcher_present ?? false,
    attachments: info?.kanban.attachments ?? false,
    lastPolledAt: isoOrNull(boardRow?.lastPolledAt),
    lastError: boardRow?.lastError ?? null,
    minVersion: AUTOMATION_MIN_PLUGIN_VERSION,
    working: readWorkingSnapshot(channelId),
  });
}
