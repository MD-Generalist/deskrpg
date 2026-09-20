// POST /api/channels/:id/projects/:projectId/archive — 보관(상태 전이 + 사건 수신 보드 이전)
import type { NextRequest } from "next/server";

import { postProjectArchive, type ChannelParams } from "@/lib/project-routes";

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId } = await params;
  return postProjectArchive(req, id, projectId ?? "");
}
