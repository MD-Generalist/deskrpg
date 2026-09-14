// POST /api/channels/:id/cron/jobs/:jobId/run — {npcId} (출처 채널 멤버만)
import type { NextRequest } from "next/server";

import { mutateFromBody } from "@/lib/cron-routes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id, jobId } = await params;
  return mutateFromBody(req, id, jobId, { kind: "run" });
}
