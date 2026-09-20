// GET /api/channels/:id/attention — 사람이 답해야 하는 것만 (채널 멤버)
import type { NextRequest } from "next/server";

import { getAttentionInbox, type ChannelParams } from "@/lib/attention-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return getAttentionInbox(req, id);
}
