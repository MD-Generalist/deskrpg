// POST /api/channels/:id/cron/blueprints/instantiate — {npcId, blueprint, values} → 201, 출처 기록
import type { NextRequest } from "next/server";

import { instantiateCronBlueprint, type RouteParams } from "@/lib/cron-routes";

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return instantiateCronBlueprint(req, id);
}
