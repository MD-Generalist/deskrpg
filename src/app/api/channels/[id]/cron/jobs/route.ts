// GET  /api/channels/:id/cron/jobs?npcId=   — 채널 active NPC 들의 크론 합집합(npcId 로 필터)
// POST /api/channels/:id/cron/jobs          — 담당 NPC 의 프로필로 생성, 성공하면 출처 기록
import type { NextRequest } from "next/server";

import { createCronJob, listCronJobs, type RouteParams } from "@/lib/cron-routes";

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return listCronJobs(req, id);
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return createCronJob(req, id);
}
