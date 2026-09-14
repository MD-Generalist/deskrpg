// GET /api/channels/:id/cron/delivery-targets?npcId= — 그 프로필의 전달 대상 목록
import type { NextRequest } from "next/server";

import { listCronDeliveryTargets, type RouteParams } from "@/lib/cron-routes";

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return listCronDeliveryTargets(req, id);
}
