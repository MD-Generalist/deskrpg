// POST /api/channels/:id/kanban/dispatch — ready 카드를 띄운다(수동)
import type { NextRequest } from "next/server";

import { dispatchBoard, type ChannelParams } from "@/lib/kanban-routes";

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return dispatchBoard(req, id);
}
