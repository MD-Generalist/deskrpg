// GET /api/channels/:id/artifacts/:artifactId/versions/:v/content — 결과물 원문 스트림(Range 지원)
import type { NextRequest } from "next/server";

import { getArtifactContent, type ArtifactParams } from "@/lib/artifact-routes";

export async function GET(req: NextRequest, { params }: ArtifactParams) {
  const { id, artifactId, v } = await params;
  return getArtifactContent(req, id, artifactId ?? "", v ?? "");
}
