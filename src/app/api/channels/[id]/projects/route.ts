// GET /api/channels/:id/projects — 프로젝트 목록(보드 메타 + 우리 메타 + 진행률)
// POST — 프로젝트(= Hermes 보드) 생성
import type { NextRequest } from "next/server";

import { listProjects, postProject, type ChannelParams } from "@/lib/project-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return listProjects(req, id);
}

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return postProject(req, id);
}
