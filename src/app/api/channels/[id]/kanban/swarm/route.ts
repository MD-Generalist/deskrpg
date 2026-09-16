// POST /api/channels/:id/kanban/swarm — Hermes 스웜 그래프를 만든다
import type { NextRequest } from "next/server";

import { createSwarm, type ChannelParams } from "@/lib/kanban-routes";

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return createSwarm(req, id);
}
