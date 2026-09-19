import assert from "node:assert/strict";
import test from "node:test";

import { deleteConfirmParams, deletedNoticeFrom, visibleSections } from "./employee-detail-view";

test("삭제 확인 문구에 usage 수치가 들어간다", () => {
  assert.deepEqual(deleteConfirmParams("oliver", { npcs: 2, channels: 2 }), {
    name: "oliver",
    npcs: "2",
    channels: "2",
  });
});

test("usage 를 못 읽었으면 0 으로 묻는다 — 수치를 지어내지 않는다", () => {
  assert.deepEqual(deleteConfirmParams("oliver", null), {
    name: "oliver",
    npcs: "0",
    channels: "0",
  });
  assert.deepEqual(deleteConfirmParams("oliver", { npcs: "설명 불가" }), {
    name: "oliver",
    npcs: "0",
    channels: "0",
  });
});

test("삭제 뒤 알림은 서버의 deletedNpcs·channels 를 그대로 읽는다", () => {
  // 예전 코드는 `unboundNpcs` 를 읽어 알림이 늘 0 으로 계산돼 조용히 사라졌다.
  assert.deepEqual(deletedNoticeFrom({ ok: true, deletedNpcs: 2, channels: 2 }), {
    npcs: 2,
    channels: 2,
  });
  assert.equal(deletedNoticeFrom({ ok: true, unboundNpcs: 2 }), null);
  assert.equal(deletedNoticeFrom({ ok: true, deletedNpcs: 0 }), null);
});

test("공유받은 사용자에게는 인격·외형·계정 편집을 보이지 않는다", () => {
  assert.deepEqual(visibleSections(true), ["status", "persona", "account"]);
  assert.deepEqual(visibleSections(false), ["status"]);
});
