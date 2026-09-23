// NPC 스킬 관리 REST — 분기표는 `@/lib/skill-routes`.
import type { NextRequest } from "next/server";

import { handleSkillRoute } from "@/lib/skill-routes";

type Ctx = { params: Promise<{ id: string; npcId: string; path?: string[] }> };

const handle = async (req: NextRequest, { params }: Ctx) => handleSkillRoute(req, await params);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
