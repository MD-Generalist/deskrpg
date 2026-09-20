import assert from "node:assert/strict";
import test from "node:test";

import { createAvatarLookup } from "./avatar-lookup";

const lookup = createAvatarLookup(
  [
    { id: "npc-1", name: "noah", appearance: { officeLookId: "office-tae" } },
    { id: "npc-2", name: "sophie", appearance: { officeLookId: "office-jun" } },
  ],
  [
    { userId: "u1", name: "단테", appearance: { officeLookId: "office-min" } },
    { userId: null, name: "손님", appearance: { officeLookId: "office-guest" } },
  ],
);

test("id 로 먼저 찾는다 — 이름이 바뀌었어도 맞는 외형을 준다", () => {
  assert.deepEqual(lookup({ kind: "npc", id: "npc-1", name: "옛이름" }), {
    officeLookId: "office-tae",
  });
  assert.deepEqual(lookup({ kind: "user", id: "u1", name: "옛닉네임" }), {
    officeLookId: "office-min",
  });
});

test("id 가 없으면 이름으로 찾는다 — 옛 메시지에는 senderId 가 없다", () => {
  assert.deepEqual(lookup({ kind: "npc", id: null, name: "sophie" }), {
    officeLookId: "office-jun",
  });
  assert.deepEqual(lookup({ kind: "user", name: "손님" }), { officeLookId: "office-guest" });
});

test("직원과 사람을 섞어 찾지 않는다 — 같은 이름이어도 종류가 다르면 남이다", () => {
  assert.equal(lookup({ kind: "user", name: "noah" }), null);
  assert.equal(lookup({ kind: "npc", name: "단테" }), null);
});

test("못 찾으면 null — 아바타는 기본 표시로 떨어진다", () => {
  assert.equal(lookup({ kind: "npc", id: "npc-없음", name: "없는직원" }), null);
});
