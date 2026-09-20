// POST /api/channels/:id/projects/:projectId/subprojects/:subprojectId/archive
import type { NextRequest } from "next/server";

import { postSubprojectArchive, type ChannelParams } from "@/lib/project-routes";

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId, subprojectId } = await params;
  return postSubprojectArchive(req, id, projectId ?? "", subprojectId ?? "");
}
