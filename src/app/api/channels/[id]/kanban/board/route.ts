// GET /api/channels/:id/kanban/board?include_archived= — 보드 + NPC 로스터(assignee → npc 매핑용)
import type { NextRequest } from "next/server";

import { getBoard, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return getBoard(req, id);
}
