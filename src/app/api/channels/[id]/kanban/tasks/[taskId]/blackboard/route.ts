// GET /api/channels/:id/kanban/tasks/:taskId/blackboard — 스웜 루트의 공유 블랙보드
import type { NextRequest } from "next/server";

import { getBlackboard, type TaskParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return getBlackboard(req, id, taskId);
}
