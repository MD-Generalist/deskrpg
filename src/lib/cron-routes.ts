/**
 * 크론 REST 라우트 핸들러들이 공유하는 몸통.
 *
 * 라우트 파일(`src/app/api/channels/[id]/cron/**`)은 얇게 두고 — 본문 파싱, 문지기
 * (`cron-access.ts`), 출처 장부(`cron-origins.ts`), Hermes 호출, 응답 조립 — 의 순서를
 * 여기 한 곳에 고정한다. pause/resume/run/PUT/DELETE 는 "출처 채널 멤버만" 이라는 같은
 * 규칙을 타므로 `mutateCronJob` 하나로 모은다.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { schedulePollNow } from "@/lib/automation-poll-trigger";
import {
  cronError,
  listNpcProfileClients,
  pluginFailureResponse,
  pluginFailureSummary,
  resolveCronChannelContext,
  resolveNpcProfileClient,
  type CronChannelContext,
  type NpcProfileClient,
} from "@/lib/cron-access";
import {
  cleanupOrphanCronOrigins,
  computeEditable,
  deleteCronOrigin,
  enrichJob,
  findCronOrigin,
  loadCronOriginIndex,
  recordCronOrigin,
  type EnrichedCronJob,
} from "@/lib/cron-origins";
import type {
  CreateCronJobBody,
  CronJob,
  InstantiateBlueprintBody,
  UpdateCronJobBody,
} from "@/lib/hermes/deskrpg-plugin-types";
import type { PluginResponse } from "@/lib/hermes/plugin-client-types";
import { getUserId } from "@/lib/internal-rpc";

export type RouteParams = { params: Promise<{ id: string; jobId?: string }> };

// ---------------------------------------------------------------------------
// 본문·쿼리
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>;

/** JSON 본문. 비어 있거나 깨졌으면 null — 호출부가 400 을 낸다. */
export async function readJsonBody(req: NextRequest): Promise<JsonBody | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonBody)
      : null;
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function invalidBody(message: string) {
  return cronError(400, "invalid_body", message);
}

/**
 * R17 생성 본문. `npcId` 는 여기서 떼어 낸다 — Hermes 로 나가는 본문에 섞이면 안 된다.
 * 프리셋→표현식 변환은 클라이언트가 하므로 `schedule` 은 문자열 그대로 넘긴다.
 * `prompt` 는 스크립트 전용 잡(`script` 가 있음)이 아니면 필수다 — 둘 다 비면 400.
 */
export function parseCreateBody(
  body: JsonBody,
): { ok: true; npcId: string; job: CreateCronJobBody } | { ok: false; response: NextResponse } {
  const npcId = requiredString(body.npcId);
  if (!npcId) return { ok: false, response: invalidBody("npcId is required") };
  const name = requiredString(body.name);
  const prompt = requiredString(body.prompt);
  const script = requiredString(body.script);
  const schedule = optionalString(body.schedule);
  if (!name || schedule === undefined) {
    return { ok: false, response: invalidBody("name and schedule are required") };
  }
  if (!prompt && !script) {
    return { ok: false, response: invalidBody("prompt is required unless script is given") };
  }
  const skills = Array.isArray(body.skills)
    ? body.skills.filter((s): s is string => typeof s === "string")
    : undefined;
  const job: CreateCronJobBody = {
    name,
    ...(prompt ? { prompt } : {}),
    ...(script ? { script } : {}),
    schedule,
    deliver: optionalString(body.deliver) ?? "local",
    ...(optionalString(body.model) !== undefined ? { model: body.model as string } : {}),
    ...(optionalString(body.provider) !== undefined ? { provider: body.provider as string } : {}),
    ...(skills ? { skills } : {}),
    ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}),
    ...(typeof body.repeat === "boolean" ? { repeat: body.repeat } : {}),
  };
  return { ok: true, npcId, job };
}

/** R17 수정 본문 — `{npcId, updates:{...}}`. 모르는 키는 버린다. */
export function parseUpdateBody(
  body: JsonBody,
): { ok: true; npcId: string; update: UpdateCronJobBody } | { ok: false; response: NextResponse } {
  const npcId = requiredString(body.npcId);
  if (!npcId) return { ok: false, response: invalidBody("npcId is required") };
  const raw = body.updates;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, response: invalidBody("updates must be an object") };
  }
  const src = raw as JsonBody;
  const updates: UpdateCronJobBody["updates"] = {};
  if (typeof src.schedule === "string") updates.schedule = src.schedule;
  if (typeof src.prompt === "string") updates.prompt = src.prompt;
  if (typeof src.name === "string") updates.name = src.name;
  if (typeof src.deliver === "string") updates.deliver = src.deliver;
  if ("model" in src && (typeof src.model === "string" || src.model === null)) {
    updates.model = src.model;
  }
  if ("provider" in src && (typeof src.provider === "string" || src.provider === null)) {
    updates.provider = src.provider;
  }
  if (typeof src.enabled === "boolean") updates.enabled = src.enabled;
  return { ok: true, npcId, update: { updates } };
}

/** R21 인스턴스화 본문 — `{npcId, blueprint, values}`. */
export function parseInstantiateBody(
  body: JsonBody,
):
  | { ok: true; npcId: string; request: InstantiateBlueprintBody }
  | { ok: false; response: NextResponse } {
  const npcId = requiredString(body.npcId);
  if (!npcId) return { ok: false, response: invalidBody("npcId is required") };
  const blueprint = requiredString(body.blueprint);
  if (!blueprint) return { ok: false, response: invalidBody("blueprint is required") };
  const values: Record<string, string> = {};
  if (typeof body.values === "object" && body.values !== null && !Array.isArray(body.values)) {
    for (const [key, value] of Object.entries(body.values as JsonBody)) {
      if (typeof value === "string") values[key] = value;
    }
  }
  return { ok: true, npcId, request: { blueprint, values } };
}

/** `?npcId=` — 본문이 없는 GET/DELETE 가 담당 NPC 를 지정하는 방법. */
export function readNpcIdParam(req: NextRequest): string | null {
  const value = req.nextUrl.searchParams.get("npcId");
  return value && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// 공통 흐름
// ---------------------------------------------------------------------------

type Resolved = { ctx: CronChannelContext; npc: NpcProfileClient };

/** 로그인 → 멤버 → 게이트웨이 → 플러그인 게이트 → NPC. 어디서든 막히면 응답을 돌려준다. */
export async function resolveCronRequest(
  req: NextRequest,
  channelId: string,
  npcId: string | null,
): Promise<{ ok: true; value: Resolved } | { ok: false; response: NextResponse }> {
  const context = await resolveCronChannelContext({ userId: getUserId(req), channelId });
  if (!context.ok) return context;
  if (!npcId) return { ok: false, response: invalidBody("npcId is required") };
  const npc = await resolveNpcProfileClient(context.ctx, npcId);
  if (!npc.ok) return npc;
  return { ok: true, value: { ctx: context.ctx, npc: npc.value } };
}

async function enrichOne({ ctx, npc }: Resolved, job: CronJob): Promise<EnrichedCronJob> {
  const origin = await findCronOrigin({
    gatewayId: ctx.gateway.id,
    profileName: npc.profile.profileName,
    jobId: job.id,
  });
  return enrichJob(job, {
    npcId: npc.npc.id,
    npcName: npc.npcName,
    origin,
    channelId: ctx.channelId,
    currentGatewayId: ctx.gateway.id,
  });
}

/** 생성·인스턴스화 뒤 — 플러그인이 성공했을 때만 출처를 적고 201 로 돌려준다. */
async function createdJobResponse(resolved: Resolved, res: PluginResponse<{ job: CronJob }>) {
  if (!res.ok) return pluginFailureResponse(res);
  const { ctx, npc } = resolved;
  await recordCronOrigin({
    gatewayId: ctx.gateway.id,
    profileName: npc.profile.profileName,
    jobId: res.data.job.id,
    channelId: ctx.channelId,
    createdByUserId: ctx.userId,
  });
  // R24. 조작 직후 즉시 폴링 — 기다리지 않는다.
  schedulePollNow(ctx.channelId);
  return NextResponse.json({ job: await enrichOne(resolved, res.data.job) }, { status: 201 });
}

// ---------------------------------------------------------------------------
// 핸들러 몸통
// ---------------------------------------------------------------------------

export async function listCronJobs(req: NextRequest, channelId: string) {
  const context = await resolveCronChannelContext({ userId: getUserId(req), channelId });
  if (!context.ok) return context.response;
  const ctx = context.ctx;

  // E3. 프로필이 사라진 출처 행은 목록을 볼 때 치운다.
  await cleanupOrphanCronOrigins(ctx.gateway.id);

  const npcIdFilter = readNpcIdParam(req);
  let targets: NpcProfileClient[];
  if (npcIdFilter) {
    const one = await resolveNpcProfileClient(ctx, npcIdFilter);
    if (!one.ok) return one.response;
    targets = [one.value];
  } else {
    targets = await listNpcProfileClients(ctx);
  }

  const origins = await loadCronOriginIndex(ctx.gateway.id);
  const jobs: EnrichedCronJob[] = [];
  const errors: Array<{ npcId: string; code: string; message: string }> = [];

  // 프로필마다 따로 부른다 — 하나가 죽어도 나머지 목록은 살아야 한다.
  const results = await Promise.all(
    targets.map(async (npc) => ({
      npc,
      res: await npc.client.cron.listJobs({ includeDisabled: true }),
    })),
  );
  for (const { npc, res } of results) {
    if (!res.ok) {
      errors.push({ npcId: npc.npc.id, ...pluginFailureSummary(res) });
      continue;
    }
    for (const job of res.data.jobs) {
      jobs.push(
        enrichJob(job, {
          npcId: npc.npc.id,
          npcName: npc.npcName,
          origin: origins.get(npc.profile.profileName, job.id),
          channelId: ctx.channelId,
          currentGatewayId: ctx.gateway.id,
        }),
      );
    }
  }

  return NextResponse.json({
    jobs,
    timezone: ctx.timezone,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

export async function getCronJob(req: NextRequest, channelId: string, jobId: string) {
  const resolved = await resolveCronRequest(req, channelId, readNpcIdParam(req));
  if (!resolved.ok) return resolved.response;
  const res = await resolved.value.npc.client.cron.getJob(jobId);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({
    job: await enrichOne(resolved.value, res.data.job),
    timezone: resolved.value.ctx.timezone,
  });
}

const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 200;

export async function listCronJobRuns(req: NextRequest, channelId: string, jobId: string) {
  const resolved = await resolveCronRequest(req, channelId, readNpcIdParam(req));
  if (!resolved.ok) return resolved.response;
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_RUNS_LIMIT)
      : DEFAULT_RUNS_LIMIT;
  const res = await resolved.value.npc.client.cron.listRuns(jobId, { limit });
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ runs: res.data.runs, limit });
}

export async function createCronJob(req: NextRequest, channelId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return parsed.response;
  const resolved = await resolveCronRequest(req, channelId, parsed.npcId);
  if (!resolved.ok) return resolved.response;
  return createdJobResponse(
    resolved.value,
    await resolved.value.npc.client.cron.createJob(parsed.job),
  );
}

export async function instantiateCronBlueprint(req: NextRequest, channelId: string) {
  const body = await readJsonBody(req);
  if (!body) return invalidBody("JSON body required");
  const parsed = parseInstantiateBody(body);
  if (!parsed.ok) return parsed.response;
  const resolved = await resolveCronRequest(req, channelId, parsed.npcId);
  if (!resolved.ok) return resolved.response;
  return createdJobResponse(
    resolved.value,
    await resolved.value.npc.client.cron.instantiateBlueprint(parsed.request),
  );
}

export async function listCronDeliveryTargets(req: NextRequest, channelId: string) {
  const resolved = await resolveCronRequest(req, channelId, readNpcIdParam(req));
  if (!resolved.ok) return resolved.response;
  const res = await resolved.value.npc.client.cron.listDeliveryTargets();
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ targets: res.data.targets });
}

export async function listCronBlueprints(req: NextRequest, channelId: string) {
  const resolved = await resolveCronRequest(req, channelId, readNpcIdParam(req));
  if (!resolved.ok) return resolved.response;
  const res = await resolved.value.npc.client.cron.listBlueprints();
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ blueprints: res.data.blueprints });
}

// ---------------------------------------------------------------------------
// 변경 — 출처 채널 멤버만 (R16)
// ---------------------------------------------------------------------------

export type CronMutation =
  | { kind: "update"; update: UpdateCronJobBody }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "run" }
  | { kind: "delete" };

/**
 * 편집·멈춤·재개·실행·삭제의 공통 몸통. 출처가 이 채널(그리고 현재 게이트웨이)의 것이
 * 아니면 403 `cron_read_only` — **Hermes 를 부르기 전에** 끝난다. 삭제가 성공하면 출처 행도
 * 지운다.
 */
export async function mutateCronJob(
  req: NextRequest,
  channelId: string,
  jobId: string,
  npcId: string | null,
  mutation: CronMutation,
) {
  const resolved = await resolveCronRequest(req, channelId, npcId);
  if (!resolved.ok) return resolved.response;
  const { ctx, npc } = resolved.value;

  const key = { gatewayId: ctx.gateway.id, profileName: npc.profile.profileName, jobId };
  const origin = await findCronOrigin(key);
  if (!computeEditable(origin, ctx.channelId, ctx.gateway.id)) {
    return cronError(
      403,
      "cron_read_only",
      "This cron job can only be changed from the channel it was created in",
    );
  }

  const cron = npc.client.cron;
  switch (mutation.kind) {
    case "update": {
      const res = await cron.updateJob(jobId, mutation.update);
      if (!res.ok) return pluginFailureResponse(res);
      schedulePollNow(ctx.channelId);
      return NextResponse.json({ job: await enrichOne(resolved.value, res.data.job) });
    }
    case "pause":
    case "resume": {
      const res =
        mutation.kind === "pause" ? await cron.pauseJob(jobId) : await cron.resumeJob(jobId);
      if (!res.ok) return pluginFailureResponse(res);
      schedulePollNow(ctx.channelId);
      return NextResponse.json({ job: await enrichOne(resolved.value, res.data.job) });
    }
    case "run": {
      // R19. 요청만 넣고 바로 돌아온다 — 결과는 이력(runs)·이벤트로 본다.
      const res = await cron.runJob(jobId);
      if (!res.ok) return pluginFailureResponse(res);
      schedulePollNow(ctx.channelId);
      return NextResponse.json({ accepted: true }, { status: 202 });
    }
    case "delete": {
      const res = await cron.deleteJob(jobId);
      if (!res.ok) return pluginFailureResponse(res);
      await deleteCronOrigin(key);
      schedulePollNow(ctx.channelId);
      return NextResponse.json({ ok: true });
    }
  }
}

/** 본문에서 `npcId` 만 읽는 변경(pause/resume/run). */
export async function mutateFromBody(
  req: NextRequest,
  channelId: string,
  jobId: string,
  mutation: CronMutation,
) {
  const body = await readJsonBody(req);
  const npcId = body ? requiredString(body.npcId) : null;
  return mutateCronJob(req, channelId, jobId, npcId, mutation);
}
