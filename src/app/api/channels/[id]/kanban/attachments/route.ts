// GET /api/channels/:id/kanban/attachments?board=&cursor= — 보드 전체의 카드 첨부(결과물 갤러리)
import type { NextRequest } from "next/server";

import { listBoardAttachments, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return listBoardAttachments(req, id);
}
