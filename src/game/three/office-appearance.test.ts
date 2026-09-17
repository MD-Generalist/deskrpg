import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEMALE_OFFICE_LOOK_ID,
  DEFAULT_OFFICE_LOOK_ID,
  defaultOfficeAppearance,
  isOfficeLookId,
  normalizeOfficeAppearance,
  validateOfficeAppearance,
} from "./office-appearance";
import { OFFICE_LOOKS, officeLookAppearance } from "./office-looks";

const female = OFFICE_LOOKS.find((look) => look.bodyType === "female")!;

test("기본 룩 두 개는 실제 목록에 있고 성별이 맞다", () => {
  assert.equal(OFFICE_LOOKS.find((l) => l.id === DEFAULT_OFFICE_LOOK_ID)?.bodyType, "male");
  assert.equal(
    OFFICE_LOOKS.find((l) => l.id === DEFAULT_FEMALE_OFFICE_LOOK_ID)?.bodyType,
    "female",
  );
  assert.deepEqual(defaultOfficeAppearance(), { officeLookId: "office-jun", bodyType: "male" });
  assert.notEqual(defaultOfficeAppearance(), defaultOfficeAppearance());
});

test("변환 규칙 표 — 옛 외형은 성별로 접히고 레이어 키는 버린다", () => {
  const legacyLayers = { layers: { body: { itemKey: "body", variant: "light" } } };
  assert.deepEqual(normalizeOfficeAppearance({ bodyType: "female", ...legacyLayers }), {
    officeLookId: "office-nari",
    bodyType: "female",
  });
  assert.deepEqual(normalizeOfficeAppearance({ bodyType: "male", ...legacyLayers }), {
    officeLookId: "office-jun",
    bodyType: "male",
  });
  assert.deepEqual(normalizeOfficeAppearance({ ...legacyLayers }), {
    officeLookId: "office-jun",
    bodyType: "male",
  });
  assert.deepEqual(normalizeOfficeAppearance({ bodyType: "robot" }), {
    officeLookId: "office-jun",
    bodyType: "male",
  });
  assert.deepEqual(normalizeOfficeAppearance({ officeLookId: "missing", bodyType: "female" }), {
    officeLookId: "office-nari",
    bodyType: "female",
  });
  assert.deepEqual(normalizeOfficeAppearance({}), { officeLookId: "office-jun", bodyType: "male" });
  assert.deepEqual(normalizeOfficeAppearance(12), { officeLookId: "office-jun", bodyType: "male" });
  assert.deepEqual(normalizeOfficeAppearance([]), { officeLookId: "office-jun", bodyType: "male" });
});

test("유효한 룩은 유지되고 bodyType 불일치는 룩의 값으로 덮어쓴다", () => {
  assert.deepEqual(normalizeOfficeAppearance({ officeLookId: female.id, bodyType: "male" }), {
    officeLookId: female.id,
    bodyType: "female",
  });
  assert.deepEqual(normalizeOfficeAppearance({ officeLookId: female.id }), {
    officeLookId: female.id,
    bodyType: "female",
  });
  for (const look of OFFICE_LOOKS)
    assert.deepEqual(normalizeOfficeAppearance(officeLookAppearance(look.id)), {
      officeLookId: look.id,
      bodyType: look.bodyType,
    });
});

test("추가 키는 보존한다", () => {
  assert.deepEqual(
    normalizeOfficeAppearance({ officeLookId: "office-jun", bodyType: "male", accent: "#f00" }),
    { officeLookId: "office-jun", bodyType: "male", accent: "#f00" },
  );
});

test("문자열은 파싱 뒤 같은 규칙, 파싱 실패는 기본 룩", () => {
  assert.deepEqual(
    normalizeOfficeAppearance(JSON.stringify({ officeLookId: female.id, bodyType: "male" })),
    { officeLookId: female.id, bodyType: "female" },
  );
  assert.deepEqual(normalizeOfficeAppearance(JSON.stringify({ bodyType: "female" })), {
    officeLookId: "office-nari",
    bodyType: "female",
  });
  assert.deepEqual(normalizeOfficeAppearance("{broken"), {
    officeLookId: "office-jun",
    bodyType: "male",
  });
  assert.deepEqual(normalizeOfficeAppearance("null"), {
    officeLookId: "office-jun",
    bodyType: "male",
  });
});

test("null 과 undefined 는 null 로 남는다", () => {
  assert.equal(normalizeOfficeAppearance(null), null);
  assert.equal(normalizeOfficeAppearance(undefined), null);
});

test("정규화는 입력을 변형하지 않는다", () => {
  const input = { officeLookId: female.id, bodyType: "male", layers: {} };
  const copy = structuredClone(input);
  normalizeOfficeAppearance(input);
  assert.deepEqual(input, copy);
});

test("REST 검증 — officeLookId 가 없거나 모르는 값이면 거절, bodyType 불일치는 통과", () => {
  assert.equal(validateOfficeAppearance({ officeLookId: "office-jun", bodyType: "male" }), null);
  assert.equal(validateOfficeAppearance({ officeLookId: female.id, bodyType: "male" }), null);
  assert.equal(validateOfficeAppearance({ officeLookId: female.id }), null);
  for (const bad of [
    null,
    undefined,
    "garbage",
    12,
    [],
    {},
    { bodyType: "male" },
    { officeLookId: "" },
    { officeLookId: "missing", bodyType: "male" },
    { officeLookId: 3 },
    { bodyType: "male", layers: { body: { itemKey: "body", variant: "light" } } },
  ])
    assert.equal(typeof validateOfficeAppearance(bad), "string", JSON.stringify(bad));
  assert.equal(isOfficeLookId("office-jun"), true);
  assert.equal(isOfficeLookId("nope"), false);
  assert.equal(isOfficeLookId(undefined), false);
});

test("officeLookAppearance 는 정본 두 키만 만든다", () => {
  for (const look of OFFICE_LOOKS)
    assert.deepEqual(officeLookAppearance(look.id), {
      officeLookId: look.id,
      bodyType: look.bodyType,
    });
});
