// GET   /api/channels/:id/kanban/settings — 보드 작업 폴더 + 호스트 운영 설정(채널·게이트웨이 소유자만 보임)
// PATCH /api/channels/:id/kanban/settings — board(채널 소유자) / orchestration(게이트웨이 소유자)
import type { NextRequest } from "next/server";

import { getSettings, patchSettings, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return getSettings(req, id);
}

export async function PATCH(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return patchSettings(req, id);
}
