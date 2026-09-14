// GET    /api/channels/:id/kanban/tasks/:taskId — 상세
// PATCH  /api/channels/:id/kanban/tasks/:taskId — 부분 갱신(status 바뀌면 dispatch 한 번)
// DELETE /api/channels/:id/kanban/tasks/:taskId — 삭제
import type { NextRequest } from "next/server";

import { deleteTask, getTask, updateTask, type TaskParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return getTask(req, id, taskId);
}

export async function PATCH(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return updateTask(req, id, taskId);
}

export async function DELETE(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return deleteTask(req, id, taskId);
}
