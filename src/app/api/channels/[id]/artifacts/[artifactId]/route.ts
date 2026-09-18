// GET /api/channels/:id/artifacts/:artifactId — 상세(버전 목록)
import type { NextRequest } from "next/server";

import { getArtifact, type ArtifactParams } from "@/lib/artifact-routes";

export async function GET(req: NextRequest, { params }: ArtifactParams) {
  const { id, artifactId } = await params;
  return getArtifact(req, id, artifactId ?? "");
}
