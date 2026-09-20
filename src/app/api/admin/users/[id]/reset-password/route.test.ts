import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "reset-password-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const req = (targetId: string, actorId?: string) =>
  new NextRequest(`http://localhost:3102/api/admin/users/${targetId}/reset-password`, {
    method: "POST",
    headers: { host: "localhost:3102", ...(actorId ? { "x-user-id": actorId } : {}) },
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedUser(role = "user") {
  const { db, users } = await import("@/db");
  const { hashPassword } = await import("@/lib/password");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Reset-${randomUUID()}`,
      passwordHash: await hashPassword("original-password"),
      systemRole: role,
    })
    .returning();
  return row;
}

async function readUser(id: string) {
  const { db, users } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

test("익명과 일반 사용자는 재설정할 수 없고 대상 해시도 그대로다", async () => {
  const { POST } = await import("./route");
  const target = await seedUser();

  const anonymous = await POST(req(target.id), params(target.id));
  assert.equal(anonymous.status, 401);

  const ordinary = await seedUser();
  const denied = await POST(req(target.id, ordinary.id), params(target.id));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).errorCode, "system_admin_required");

  assert.equal((await readUser(target.id)).passwordHash, target.passwordHash);
});

test("관리자는 임시 비밀번호를 1회 돌려받고 대상은 강제 변경 상태가 된다", async () => {
  const { POST } = await import("./route");
  const admin = await seedUser("system_admin");
  const target = await seedUser();

  const response = await POST(req(target.id, admin.id), params(target.id));
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    temporaryPassword: string;
    user: { id: string; loginId: string; nickname: string };
  };
  assert.equal(payload.user.id, target.id);
  assert.equal(payload.user.loginId, target.loginId);
  assert.ok(payload.temporaryPassword.length >= 12);

  const stored = await readUser(target.id);
  assert.notEqual(stored.passwordHash, target.passwordHash);
  assert.equal(stored.mustChangePassword, true);

  // 임시 비밀번호는 평문으로 저장되지 않는다 — 해시만 남는다.
  assert.notEqual(stored.passwordHash, payload.temporaryPassword);
  const { verifyPassword } = await import("@/lib/password");
  assert.ok(await verifyPassword(payload.temporaryPassword, stored.passwordHash));
});

test("임시 비밀번호는 매번 다르고 계정 비밀번호 정책을 만족한다", async () => {
  const { POST } = await import("./route");
  const { isAccountPasswordValid } = await import("@/lib/security-policy");
  const admin = await seedUser("system_admin");
  const target = await seedUser();

  const first = await (await POST(req(target.id, admin.id), params(target.id))).json();
  const second = await (await POST(req(target.id, admin.id), params(target.id))).json();

  assert.notEqual(first.temporaryPassword, second.temporaryPassword);
  assert.ok(isAccountPasswordValid(first.temporaryPassword));
});

test("없는 사용자를 재설정하면 404 다", async () => {
  const { POST } = await import("./route");
  const admin = await seedUser("system_admin");
  const missing = randomUUID();

  const response = await POST(req(missing, admin.id), params(missing));

  assert.equal(response.status, 404);
  assert.equal((await response.json()).errorCode, "user_not_found");
});
