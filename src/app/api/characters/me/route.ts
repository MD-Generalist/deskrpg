import { NextRequest, NextResponse } from "next/server";

import { getMyCharacter } from "@/lib/my-character";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

/** 내 캐릭터 — 사용자당 하나. 없으면 null(화면은 등록 폼을 보인다). */
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ character: await getMyCharacter(userId) });
}
