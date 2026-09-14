// GET    /api/channels/:id/cron/jobs/:jobId?npcId=  — 상세
// PUT    /api/channels/:id/cron/jobs/:jobId         — {npcId, updates} (출처 채널 멤버만)
// DELETE /api/channels/:id/cron/jobs/:jobId?npcId=  — 삭제 + 출처 제거 (출처 채널 멤버만)
import type { NextRequest } from "next/server";

import {
  getCronJob,
  mutateCronJob,
  parseUpdateBody,
  readJsonBody,
  readNpcIdParam,
} from "@/lib/cron-routes";
import { cronError } from "@/lib/cron-access";

type JobParams = { params: Promise<{ id: string; jobId: string }> };

export async function GET(req: NextRequest, { params }: JobParams) {
  const { id, jobId } = await params;
  return getCronJob(req, id, jobId);
}

export async function PUT(req: NextRequest, { params }: JobParams) {
  const { id, jobId } = await params;
  const body = await readJsonBody(req);
  if (!body) return cronError(400, "invalid_body", "JSON body required");
  const parsed = parseUpdateBody(body);
  if (!parsed.ok) return parsed.response;
  return mutateCronJob(req, id, jobId, parsed.npcId, { kind: "update", update: parsed.update });
}

export async function DELETE(req: NextRequest, { params }: JobParams) {
  const { id, jobId } = await params;
  return mutateCronJob(req, id, jobId, readNpcIdParam(req), { kind: "delete" });
}
