// GET /api/channels/:id/kanban/runs?from=&to=&limit= — 창 안의 실행 기록(실적 타임라인)
import type { NextRequest } from "next/server";

import { listRuns, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return listRuns(req, id);
}
