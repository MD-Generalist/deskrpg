// GET  /api/channels/:id/kanban/tasks/:taskId/attachments — 목록
// POST /api/channels/:id/kanban/tasks/:taskId/attachments — multipart `file` 그대로 전달
// 플러그인이 첨부를 지원하지 않으면 404 attachments_unsupported.
import type { NextRequest } from "next/server";

import { listAttachments, uploadAttachment, type TaskParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return listAttachments(req, id, taskId);
}

export async function POST(req: NextRequest, { params }: TaskParams) {
  const { id, taskId } = await params;
  return uploadAttachment(req, id, taskId);
}
