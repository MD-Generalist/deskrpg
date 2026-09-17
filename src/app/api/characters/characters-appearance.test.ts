import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { authHeaders, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

/**
 * 외형의 정본 형태는 `{ officeLookId, bodyType }` 뿐이다. 캐릭터 라우트는
 * `officeLookId` 가 없거나 모르는 값이면 400 `character_appearance_invalid` 로 거절하고,
 * 통과한 값은 저장 전에 정규화한다(bodyType 을 룩의 값으로 맞춘다).
 */
setupThrowawaySqlite("characters-appearance-test");

async function post(userId: string, body: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/characters", {
      method: "POST",
      body: JSON.stringify(body),
      headers: authHeaders(userId),
    }),
  );
}

async function patch(userId: string, id: string, body: unknown) {
  const { PATCH } = await import("./[id]/route");
  return PATCH(
    new NextRequest(`http://localhost/api/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const INVALID_APPEARANCES: Array<[string, unknown]> = [
  ["officeLookId 없음", { bodyType: "male" }],
  ["모르는 룩", { officeLookId: "office-nobody", bodyType: "male" }],
  [
    "옛 레이어 형식",
    { bodyType: "female", layers: { body: { itemKey: "body", variant: "light" } } },
  ],
  ["문자열", "garbage"],
  ["배열", []],
];

test("POST 는 officeLookId 가 없거나 모르는 외형을 400 으로 거절한다", async () => {
  const user = await seedUser("char-post");
  for (const [label, appearance] of INVALID_APPEARANCES) {
    const res = await post(user.id, { name: "테스터", appearance });
    assert.equal(res.status, 400, label);
    assert.equal((await res.json()).errorCode, "character_appearance_invalid", label);
  }
});

test("POST 는 유효한 룩을 저장하고 bodyType 을 룩의 값으로 맞춘다", async () => {
  const user = await seedUser("char-post-ok");
  const res = await post(user.id, {
    name: "테스터",
    appearance: { officeLookId: "office-nari", bodyType: "male", accent: "#f00" },
  });
  assert.equal(res.status, 201);
  const { character } = await res.json();
  assert.deepEqual(character.appearance, {
    officeLookId: "office-nari",
    bodyType: "female",
    accent: "#f00",
  });
});

test("PATCH 는 모르는 외형을 400 으로 거절하고 유효한 외형은 정규화해 저장한다", async () => {
  const user = await seedUser("char-patch");
  const created = await post(user.id, {
    name: "테스터",
    appearance: { officeLookId: "office-jun", bodyType: "male" },
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).character.id as string;

  for (const [label, appearance] of INVALID_APPEARANCES) {
    const res = await patch(user.id, id, { appearance });
    assert.equal(res.status, 400, label);
    assert.equal((await res.json()).errorCode, "character_appearance_invalid", label);
  }

  const ok = await patch(user.id, id, { appearance: { officeLookId: "office-nari" } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).character.appearance, {
    officeLookId: "office-nari",
    bodyType: "female",
  });

  // 이름만 바꾸는 요청은 외형 검증을 타지 않는다.
  const nameOnly = await patch(user.id, id, { name: "새 이름" });
  assert.equal(nameOnly.status, 200);
  assert.equal((await nameOnly.json()).character.name, "새 이름");
});
