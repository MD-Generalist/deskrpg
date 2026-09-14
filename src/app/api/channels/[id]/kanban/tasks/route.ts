// POST /api/channels/:id/kanban/tasks — 카드 생성(assignee 는 npcId), 직후 dispatch 한 번
import type { NextRequest } from "next/server";

import { createTask, type ChannelParams } from "@/lib/kanban-routes";

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return createTask(req, id);
}
