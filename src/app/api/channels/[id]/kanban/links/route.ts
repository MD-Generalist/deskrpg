// GET    /api/channels/:id/kanban/links — 보드 전체의 부모·자식 쌍(묶음 조회)
// POST   /api/channels/:id/kanban/links — {parent_id, child_id} 링크 추가
// DELETE /api/channels/:id/kanban/links — {parent_id, child_id} 링크 삭제
import type { NextRequest } from "next/server";

import { listLinks, mutateLink, type ChannelParams } from "@/lib/kanban-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return listLinks(req, id);
}

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return mutateLink(req, id, "add");
}

export async function DELETE(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return mutateLink(req, id, "remove");
}
