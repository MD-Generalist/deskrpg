/**
 * 결과물(아티팩트) REST — 목록·상세. 문지기는 `artifact-access.ts`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { loadScopedArtifact, resolveArtifactChannelContext } from "@/lib/artifact-access";
import { cronError, pluginFailureResponse } from "@/lib/cron-access";
import {
  ARTIFACT_KINDS,
  ARTIFACT_SOURCES,
  ARTIFACTS_TASK_FILTER_MIN_VERSION,
} from "@/lib/hermes/deskrpg-plugin-types";
import { rawFailureResponse, streamProxyResponse } from "@/lib/hermes/stream-proxy";
import { compareSemver } from "@/lib/hermes/plugin-capability";
import { getUserId } from "@/lib/internal-rpc";

export type ArtifactParams = { params: Promise<{ id: string; artifactId?: string; v?: string }> };

const LIMIT_MAX = 200;
const MAX_EDIT_CHARS = 5_000_000;

function resolve(req: NextRequest, channelId: string) {
  return resolveArtifactChannelContext({ userId: getUserId(req), channelId });
}

export async function listArtifacts(req: NextRequest, channelId: string): Promise<Response> {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") || undefined;
  const source = sp.get("source") || undefined;
  const profile = sp.get("profile") || undefined;
  const taskId = sp.get("taskId") || undefined;
  const q = (sp.get("q") || "").slice(0, 200) || undefined;
  const rawLimit = Number(sp.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, LIMIT_MAX) : 50;
  if (kind && !(ARTIFACT_KINDS as readonly string[]).includes(kind))
    return cronError(400, "invalid_field", "kind");
  if (source && !(ARTIFACT_SOURCES as readonly string[]).includes(source)) {
    return cronError(400, "invalid_field", "source");
  }
  if (profile && !ctx.profiles.includes(profile)) return cronError(400, "invalid_field", "profile");
  if (taskId && (compareSemver(ctx.pluginVersion, ARTIFACTS_TASK_FILTER_MIN_VERSION) ?? -1) < 0) {
    return cronError(
      428,
      "plugin_upgrade_required",
      `deskrpg-hermes-plugin ${ARTIFACTS_TASK_FILTER_MIN_VERSION}+ required`,
      { minVersion: ARTIFACTS_TASK_FILTER_MIN_VERSION },
    );
  }
  // NPC 를 골랐으면 그 프로필만(보드 OR 를 빼야 다른 NPC 카드가 섞이지 않는다). 아니면 채널 범위 전체.
  const res = await ctx.client.artifacts.list({
    profiles: profile ? [profile] : ctx.profiles,
    board: profile ? undefined : ctx.boardSlug,
    kind,
    source,
    q,
    cursor: sp.get("cursor") || undefined,
    limit,
    taskId,
  });
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data);
}

export async function getArtifact(
  req: NextRequest,
  channelId: string,
  artifactId: string,
): Promise<Response> {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const loaded = await loadScopedArtifact(resolved.ctx, artifactId);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json(loaded.detail);
}

export async function getArtifactContent(
  req: NextRequest,
  channelId: string,
  artifactId: string,
  v: string,
): Promise<Response> {
  if (!/^\d{1,9}$/.test(v)) return cronError(400, "invalid_field", "v");
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const loaded = await loadScopedArtifact(resolved.ctx, artifactId);
  if (!loaded.ok) return loaded.response;
  const res = await resolved.ctx.client.artifacts.content(artifactId, Number(v), {
    download: req.nextUrl.searchParams.get("download") === "1",
    range: req.headers.get("range"),
  });
  if (!res.ok) return rawFailureResponse(res);
  return streamProxyResponse(res.response);
}

export async function addArtifactVersion(
  req: NextRequest,
  channelId: string,
  artifactId: string,
): Promise<Response> {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return cronError(400, "invalid_json", "body must be JSON");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.content !== "string" || typeof b.filename !== "string" || !b.filename.trim()) {
    return cronError(400, "missing_field", "content, filename");
  }
  if (b.content.length > MAX_EDIT_CHARS)
    return cronError(413, "artifact_too_large", "content too large");
  const note = typeof b.note === "string" ? b.note.slice(0, 400) : undefined;
  const loaded = await loadScopedArtifact(resolved.ctx, artifactId);
  if (!loaded.ok) return loaded.response;
  const res = await resolved.ctx.client.artifacts.addVersion(
    artifactId,
    { content: b.content, filename: b.filename.trim().slice(0, 200), ...(note ? { note } : {}) },
    resolved.ctx.userId,
  );
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json(res.data, { status: 201 });
}

export async function deleteArtifact(
  req: NextRequest,
  channelId: string,
  artifactId: string,
): Promise<Response> {
  const resolved = await resolve(req, channelId);
  if (!resolved.ok) return resolved.response;
  const loaded = await loadScopedArtifact(resolved.ctx, artifactId);
  if (!loaded.ok) return loaded.response;
  const res = await resolved.ctx.client.artifacts.remove(artifactId, resolved.ctx.userId);
  if (!res.ok) return pluginFailureResponse(res);
  return NextResponse.json({ ok: true });
}
