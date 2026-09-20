// POST /api/channels/:id/kanban/proposals/:proposalId/resolve — {choice:"card"|"inline"} (채널 멤버)
import type { NextRequest } from "next/server";

import { resolveCardProposal, type ProposalParams } from "@/lib/kanban-routes";

export async function POST(req: NextRequest, { params }: ProposalParams) {
  const { id, proposalId } = await params;
  return resolveCardProposal(req, id, proposalId);
}
