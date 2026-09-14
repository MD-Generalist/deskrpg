// POST /api/channels/:id/kanban/tasks/:taskId/unblock — {comment?} → ready (채널 멤버)
import type { NextRequest } from "next/server";

import { runTaskAction, type TaskParams } from "@/lib/kanban-routes";

export async function POST(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return runTaskAction(req, id, taskId, "unblock");
}
