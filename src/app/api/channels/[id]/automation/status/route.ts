// GET /api/channels/:id/automation/status — 플러그인·보드·폴링·작업 중 요약(채널 멤버)
import type { NextRequest } from "next/server";

import { getAutomationStatus, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return getAutomationStatus(req, id);
}
