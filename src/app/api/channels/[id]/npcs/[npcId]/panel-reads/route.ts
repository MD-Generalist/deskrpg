// GET  /api/channels/:id/npcs/:npcId/panel-reads → {cards, cron} (채널 멤버)
// POST /api/channels/:id/npcs/:npcId/panel-reads — {tab} → 204 (채널 멤버)
//
// 관문은 로그인 + 채널 멤버까지만 둔다. 게이트웨이·플러그인·보드는 배지 계산 안쪽
// (`loadAssignedCardIds` → `resolveKanbanChannelContextForRead`)에서 보고, 거기서 막히면
// 카드 배지만 0 이 된다 — 플러그인이 없는 설치에서도 크론 배지는 나와야 하기 때문이다.
// 그 갈래는 보드를 **확보하지 않는다**: 배지 폴링이 Hermes 보드 생성을 반복하면 안 된다.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { cronError, requireChannelMember } from "@/lib/cron-access";
import { getUserId } from "@/lib/internal-rpc";
import {
  isPanelTab,
  liveBadgeDeps,
  markTabSeen,
  readBadges,
  type PanelTarget,
} from "@/lib/npc-panel-reads";

type PanelParams = { params: Promise<{ id: string; npcId: string }> };

async function resolveTarget(
  req: NextRequest,
  params: PanelParams["params"],
): Promise<{ ok: true; target: PanelTarget } | { ok: false; response: NextResponse }> {
  const userId = getUserId(req);
  if (!userId) return { ok: false, response: cronError(401, "unauthorized", "unauthorized") };
  const { id: channelId, npcId } = await params;
  const access = await requireChannelMember(channelId, userId);
  if (!access.ok) return access;
  return { ok: true, target: { channelId, userId, npcId } };
}

export async function GET(req: NextRequest, { params }: PanelParams) {
  const resolved = await resolveTarget(req, params);
  if (!resolved.ok) return resolved.response;
  return NextResponse.json(await readBadges(resolved.target, liveBadgeDeps));
}

export async function POST(req: NextRequest, { params }: PanelParams) {
  const resolved = await resolveTarget(req, params);
  if (!resolved.ok) return resolved.response;

  const body: unknown = await req.json().catch(() => null);
  const tab = (body as { tab?: unknown } | null)?.tab;
  if (!isPanelTab(tab)) {
    return cronError(400, "invalid_body", 'tab must be "cron" or "cards"');
  }
  await markTabSeen({ ...resolved.target, tab }, liveBadgeDeps);
  return new NextResponse(null, { status: 204 });
}
