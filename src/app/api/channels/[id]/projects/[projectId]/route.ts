// GET /api/channels/:id/projects/:projectId — 상세 + 서브프로젝트
// PATCH — 메타 수정(이름·설명은 Hermes 로 위임)
import type { NextRequest } from "next/server";

import { getProject, patchProject, type ChannelParams } from "@/lib/project-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId } = await params;
  return getProject(req, id, projectId ?? "");
}

export async function PATCH(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId } = await params;
  return patchProject(req, id, projectId ?? "");
}
