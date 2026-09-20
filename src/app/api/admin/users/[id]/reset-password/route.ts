import { db, users } from "@/db";
import { hashPassword } from "@/lib/password";
import { generateTemporaryPassword } from "@/lib/temporary-password";
import {
  getAuthenticatedUserId,
  getUserSystemRole,
  systemAdminRequiredResponse,
  unauthorizedResponse,
} from "@/lib/rbac/group-api";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

/**
 * 시스템 관리자가 사용자의 비밀번호를 임시 값으로 재설정한다.
 * 평문은 이 응답에만 한 번 실린다 — DB 에도 로그에도 남기지 않는다.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actorId = getAuthenticatedUserId(req);
  if (!actorId) return unauthorizedResponse();

  const systemRole = await getUserSystemRole(actorId);
  if (systemRole !== "system_admin") return systemAdminRequiredResponse();

  const { id } = await context.params;
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    return NextResponse.json(
      { errorCode: "user_not_found", error: "user not found" },
      { status: 404 },
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true })
    .where(eq(users.id, target.id));

  return NextResponse.json({
    temporaryPassword,
    user: { id: target.id, loginId: target.loginId, nickname: target.nickname },
  });
}
