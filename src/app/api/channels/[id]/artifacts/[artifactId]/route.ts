// GET /api/channels/:id/artifacts/:artifactId — 상세(버전 목록). DELETE — 결과물 삭제.
import type { NextRequest } from "next/server";

import { deleteArtifact, getArtifact, type ArtifactParams } from "@/lib/artifact-routes";

export async function GET(req: NextRequest, { params }: ArtifactParams) {
  const { id, artifactId } = await params;
  return getArtifact(req, id, artifactId ?? "");
}

export async function DELETE(req: NextRequest, { params }: ArtifactParams) {
  const { id, artifactId } = await params;
  return deleteArtifact(req, id, artifactId ?? "");
}
