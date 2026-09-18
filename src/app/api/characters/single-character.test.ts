import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { seedUser } from "@/test-setup/npc-seed";
import { QUICK_START_APPEARANCE } from "@/lib/quick-start";

// 브리프의 { officeLookId, bodyType } 조각은 body 레이어가 없어 validateAppearance 를
// 통과하지 못한다(레지스트리는 body 레이어를 필수로 요구한다) — 검증을 통과하는
// 최소 구성(QUICK_START_APPEARANCE 와 동일)으로 바꿔 쓴다.
const APPEARANCE = QUICK_START_APPEARANCE;

function req(url: string, userId: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "x-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("내 캐릭터가 없으면 me 는 null, 만들면 그것이 me 다", async () => {
  const user = await seedUser("solo");
  const { GET: ME } = await import("./me/route");
  const { POST } = await import("./route");
  let res = await ME(req("http://localhost/api/characters/me", user.id));
  assert.deepEqual((await res.json()).character, null);
  res = await POST(
    req("http://localhost/api/characters", user.id, "POST", { name: "나", appearance: APPEARANCE }),
  );
  assert.equal(res.status, 201);
  res = await ME(req("http://localhost/api/characters/me", user.id));
  assert.equal((await res.json()).character.name, "나");
});

test("이미 있으면 둘째를 만들지 않는다 — 409", async () => {
  const user = await seedUser("dup");
  const { POST } = await import("./route");
  await POST(
    req("http://localhost/api/characters", user.id, "POST", { name: "나", appearance: APPEARANCE }),
  );
  const res = await POST(
    req("http://localhost/api/characters", user.id, "POST", { name: "둘", appearance: APPEARANCE }),
  );
  assert.equal(res.status, 409);
  assert.equal((await res.json()).errorCode, "character_already_exists");
});

test("bio 는 저장되고 2,000자를 넘으면 400", async () => {
  const user = await seedUser("bio");
  const { POST } = await import("./route");
  const { PATCH } = await import("./[id]/route");
  const created = await (
    await POST(
      req("http://localhost/api/characters", user.id, "POST", {
        name: "나",
        appearance: APPEARANCE,
      }),
    )
  ).json();
  const id = created.character.id as string;
  const ok = await PATCH(
    req(`http://localhost/api/characters/${id}`, user.id, "PATCH", {
      bio: "단테랩스 대표. 존댓말 선호.",
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).character.bio, "단테랩스 대표. 존댓말 선호.");
  const long = await PATCH(
    req(`http://localhost/api/characters/${id}`, user.id, "PATCH", { bio: "가".repeat(2001) }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(long.status, 400);
  assert.equal((await long.json()).errorCode, "character_bio_too_long");
});
