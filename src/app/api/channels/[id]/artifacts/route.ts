// GET /api/channels/:id/artifacts — 채널 결과물 목록
import type { NextRequest } from "next/server";

import { listArtifacts, type ArtifactParams } from "@/lib/artifact-routes";

export async function GET(req: NextRequest, { params }: ArtifactParams) {
  const { id } = await params;
  return listArtifacts(req, id);
}
