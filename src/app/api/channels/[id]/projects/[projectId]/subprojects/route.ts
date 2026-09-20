// GET /api/channels/:id/projects/:projectId/subprojects — 등록된 메타 + 관측된 미등록 테넌트
// POST — 서브프로젝트 등록
import type { NextRequest } from "next/server";

import { listProjectSubprojects, postSubproject, type ChannelParams } from "@/lib/project-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId } = await params;
  return listProjectSubprojects(req, id, projectId ?? "");
}

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId } = await params;
  return postSubproject(req, id, projectId ?? "");
}
