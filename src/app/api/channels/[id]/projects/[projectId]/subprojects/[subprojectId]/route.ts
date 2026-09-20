// PATCH /api/channels/:id/projects/:projectId/subprojects/:subprojectId
// 표시 이름·상태·리드·목표일을 고친다. 테넌트 슬러그는 받지 않는다 — Hermes 카드가 그 문자열을
// 들고 있어서 바꾸면 이미 만들어진 카드가 고아가 된다.
import type { NextRequest } from "next/server";

import { patchSubproject, type ChannelParams } from "@/lib/project-routes";

export async function PATCH(req: NextRequest, { params }: ChannelParams) {
  const { id, projectId, subprojectId } = await params;
  return patchSubproject(req, id, projectId ?? "", subprojectId ?? "");
}
