// GET    /api/channels/:id/kanban/attachments/:attachmentId — 첨부 조회
// DELETE /api/channels/:id/kanban/attachments/:attachmentId — 첨부 삭제
import type { NextRequest } from "next/server";

import { deleteAttachment, getAttachment, type AttachmentParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: AttachmentParams) {
  const { id, attachmentId } = await params;
  return getAttachment(req, id, attachmentId);
}

export async function DELETE(req: NextRequest, { params }: AttachmentParams) {
  const { id, attachmentId } = await params;
  return deleteAttachment(req, id, attachmentId);
}
