/**
 * 결과물(아티팩트) REST 의 문지기. 순서: 로그인 → 채널 멤버 → 게이트웨이(409) → 플러그인 게이트 →
 * `artifacts` 능력(428). 칸반과 달리 보드 행이 없어도 막지 않는다 — 칸반을 안 쓰는 채널에도 채팅 결과물은 있다.
 * 채널 범위는 서버가 정한다: 채널 NPC 프로필(잠든 NPC 포함, 현재 게이트웨이) OR 채널 보드.
 */
import { and, eq, ne } from "drizzle-orm";
import type { NextResponse } from "next/server";

import { db, hermesProfiles, npcs } from "@/db";

import {
  cronError,
  pluginFailureResponse,
  pluginGateResponse,
  requireChannelMember,
} from "@/lib/cron-access";
import { ARTIFACTS_MIN_VERSION, type ArtifactDetail } from "@/lib/hermes/deskrpg-plugin-types";
import type { OwnerPluginClient } from "@/lib/hermes/plugin-client-types";
import { loadChannelRoster } from "@/lib/kanban-access";
import { resolveChannelBoard } from "@/lib/kanban-boards";

export type ArtifactChannelContext = {
  userId: string;
  channelId: string;
  /** 채널에 지금 묶인 게이트웨이(`gateway_resources.id`). */
  gatewayId: string;
  client: OwnerPluginClient;
  boardSlug: string;
  profiles: string[];
  pluginVersion: string;
};

type Result<T> = ({ ok: true } & T) | { ok: false; response: NextResponse };

export async function resolveArtifactChannelContext(input: {
  userId: string | null;
  channelId: string;
}): Promise<Result<{ ctx: ArtifactChannelContext }>> {
  if (!input.userId) return { ok: false, response: cronError(401, "unauthorized", "unauthorized") };
  const access = await requireChannelMember(input.channelId, input.userId);
  if (!access.ok) return access;
  const resolved = await resolveChannelBoard(input.channelId);
  if (!resolved.ok) {
    return {
      ok: false,
      response: cronError(409, "gateway_not_bound", "Channel has no gateway bound"),
    };
  }
  if (!resolved.pluginGate.ok)
    return { ok: false, response: pluginGateResponse(resolved.pluginGate) };
  const info = resolved.pluginGate.info;
  if (!info.capabilities.includes("artifacts")) {
    return {
      ok: false,
      response: cronError(
        428,
        "plugin_upgrade_required",
        `deskrpg-hermes-plugin ${ARTIFACTS_MIN_VERSION}+ required`,
        {
          minVersion: ARTIFACTS_MIN_VERSION,
          missing: ["artifacts"],
        },
      ),
    };
  }
  const roster = await loadChannelRoster({
    channelId: input.channelId,
    gateway: resolved.binding.resource,
  });
  return {
    ok: true,
    ctx: {
      userId: input.userId,
      channelId: input.channelId,
      gatewayId: resolved.binding.resource.id,
      client: resolved.ownerClient,
      boardSlug: resolved.boardSlug,
      profiles: [...new Set(roster.map((r) => r.profileName))],
      pluginVersion: info.version,
    },
  };
}

export function inChannelScope(
  ctx: Pick<ArtifactChannelContext, "profiles" | "boardSlug">,
  a: { profile: string; board?: string | null },
): boolean {
  return ctx.profiles.includes(a.profile) || (!!a.board && a.board === ctx.boardSlug);
}

/** 플러그인 결과물 id 모양(`new_artifact_id` 는 [0-9a-z] 26자). `.`·`..`·`/` 는 URL 정규화로 다른 경로가 된다. */
const ARTIFACT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidArtifactId(id: string): boolean {
  return ARTIFACT_ID_RE.test(id);
}

export function artifactNotFound(): NextResponse {
  return cronError(404, "artifact_not_found", "artifact not found");
}

/** 단건 조회 + 범위 확인. 범위 밖은 없는 것과 같다(404) — id 추측으로 다른 채널에 닿지 않게. */
export async function loadScopedArtifact(
  ctx: ArtifactChannelContext,
  id: string,
): Promise<Result<{ detail: ArtifactDetail }>> {
  if (!isValidArtifactId(id)) return { ok: false, response: artifactNotFound() };
  const res = await ctx.client.artifacts.get(id);
  if (!res.ok) return { ok: false, response: pluginFailureResponse(res) };
  const artifact = (res.data as Partial<ArtifactDetail> | null)?.artifact;
  if (!artifact || !inChannelScope(ctx, artifact)) {
    return { ok: false, response: artifactNotFound() };
  }
  return { ok: true, detail: res.data };
}

/**
 * 편집·삭제 권한(2026-09-18 사용자 결정). 읽기는 채널 범위 전체지만, 바꾸는 것은 출처 채널에서만:
 * 보드 결과물은 이 채널 보드의 것일 때, 보드 없는 결과물은 그 프로필이 이 게이트웨이에서 **이 채널에만**
 * 고용돼 있을 때. 같은 프로필을 여러 채널이 고용하면 어느 채널이 만든 채팅 결과물인지 알 수 없어
 * 모든 채널에서 읽기 전용이다.
 */
export async function canModifyArtifact(
  ctx: Pick<ArtifactChannelContext, "channelId" | "gatewayId" | "boardSlug" | "profiles">,
  artifact: { profile: string; board?: string | null },
): Promise<boolean> {
  if (artifact.board) return artifact.board === ctx.boardSlug;
  if (!ctx.profiles.includes(artifact.profile)) return false;
  const [elsewhere] = await db
    .select({ id: npcs.id })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .where(
      and(
        eq(hermesProfiles.gatewayId, ctx.gatewayId),
        eq(hermesProfiles.profileName, artifact.profile),
        ne(npcs.channelId, ctx.channelId),
      ),
    )
    .limit(1);
  return !elsewhere;
}

export function artifactReadOnly(): NextResponse {
  return cronError(
    403,
    "artifact_read_only_other_channel",
    "Artifacts from another channel are read-only here",
  );
}
