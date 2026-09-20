import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "password-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const url = "http://localhost:3102/api/account/password";
const req = (body: unknown, userId?: string) =>
  new NextRequest(url, {
    method: "POST",
    headers: {
      host: "localhost:3102",
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    },
    body: JSON.stringify(body),
  });

async function seedUser(password: string, mustChangePassword = false) {
  const { db, users } = await import("@/db");
  const { hashPassword } = await import("@/lib/password");
  const [row] = await db
    .insert(users)
    .values({
      loginId: randomUUID(),
      nickname: `Pw-${randomUUID()}`,
      passwordHash: await hashPassword(password),
      mustChangePassword,
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

test("로그인하지 않은 요청은 401 이다", async () => {
  const { POST } = await import("./route");
  const response = await POST(
    req({ currentPassword: "old-password", newPassword: "new-password" }),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).errorCode, "unauthorized");
});

test("현재 비밀번호가 틀리면 401 이고 해시는 그대로다", async () => {
  const { POST } = await import("./route");
  const user = await seedUser("old-password");

  const response = await POST(
    req({ currentPassword: "wrong-password", newPassword: "new-password" }, user.id),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).errorCode, "invalid_credentials");
  assert.equal((await readUser(user.id)).passwordHash, user.passwordHash);
});

test("새 비밀번호가 8자 미만이면 400 이다", async () => {
  const { POST } = await import("./route");
  const user = await seedUser("old-password");

  const response = await POST(
    req({ currentPassword: "old-password", newPassword: "short" }, user.id),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, "password_length_invalid");
});

test("성공하면 해시가 바뀌고 강제 변경 표시가 내려가며 토큰이 재발급된다", async () => {
  const { POST } = await import("./route");
  const user = await seedUser("old-password", true);

  const response = await POST(
    req({ currentPassword: "old-password", newPassword: "new-password" }, user.id),
  );

  assert.equal(response.status, 200);
  const stored = await readUser(user.id);
  assert.notEqual(stored.passwordHash, user.passwordHash);
  assert.equal(stored.mustChangePassword, false);

  const { verifyPassword } = await import("@/lib/password");
  assert.ok(await verifyPassword("new-password", stored.passwordHash));
  assert.ok(response.cookies.get("token"));
  // 새 비밀번호를 응답에 실어 보내지 않는다.
  assert.equal(JSON.stringify(await response.json()).includes("new-password"), false);
});

test("현재 비밀번호와 같은 값으로는 바꿀 수 없다", async () => {
  const { POST } = await import("./route");
  const user = await seedUser("old-password");

  const response = await POST(
    req({ currentPassword: "old-password", newPassword: "old-password" }, user.id),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, "password_unchanged");
});
