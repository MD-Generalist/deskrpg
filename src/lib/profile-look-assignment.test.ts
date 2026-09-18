import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OFFICE_LOOKS } from "@/game/three/office-looks";

import { pickOfficeLookForNewProfile } from "./profile-look-assignment";

const ALL_IDS = OFFICE_LOOKS.map((look) => look.id);
/** DB 의 `appearance` 값 형태로 만든다. SQLite 는 JSON 문자열, PG 는 객체로 온다. */
const asAppearance = (ids: string[]) =>
  ids.map((id, i) =>
    i % 2 === 0 ? { officeLookId: id, bodyType: "male" } : JSON.stringify({ officeLookId: id }),
  );

describe("pickOfficeLookForNewProfile — 새 직원에게 외형을 자동으로 준다", () => {
  it("이 게이트웨이에서 아직 아무도 안 쓴 룩을 고른다", () => {
    const used = asAppearance(ALL_IDS.slice(0, ALL_IDS.length - 1));
    const picked = pickOfficeLookForNewProfile(used, () => 0);
    assert.equal(picked.officeLookId, ALL_IDS[ALL_IDS.length - 1]);
  });

  it("안 쓴 룩이 여럿이면 그 안에서 무작위로 고른다", () => {
    const unused = ALL_IDS.slice(0, 3);
    const used = asAppearance(ALL_IDS.slice(3));
    const picks = new Set(
      [0, 0.34, 0.67, 0.99].map((r) => pickOfficeLookForNewProfile(used, () => r).officeLookId),
    );
    assert.deepEqual([...picks].sort(), [...unused].sort());
  });

  it("전부 쓰였으면 겹치더라도 전체에서 고른다 — 외형 없는 직원을 만들지 않는다", () => {
    const picked = pickOfficeLookForNewProfile(asAppearance(ALL_IDS), () => 0.5);
    assert.ok(ALL_IDS.includes(picked.officeLookId));
  });

  it("모르는 id·null 이 섞여 있어도 무시한다", () => {
    const picked = pickOfficeLookForNewProfile(
      [null, { officeLookId: "office-unknown" }, "{broken", 42],
      () => 0,
    );
    assert.equal(picked.officeLookId, ALL_IDS[0]);
  });

  it("정본 형태(officeLookId·bodyType 두 키)로 돌려준다", () => {
    const picked = pickOfficeLookForNewProfile([], () => 0);
    const look = OFFICE_LOOKS[0];
    assert.deepEqual(picked, { officeLookId: look.id, bodyType: look.bodyType });
  });

  it("random 이 1 에 가까워도 범위를 벗어나지 않는다", () => {
    const picked = pickOfficeLookForNewProfile([], () => 0.999999);
    assert.equal(picked.officeLookId, ALL_IDS[ALL_IDS.length - 1]);
  });
});
