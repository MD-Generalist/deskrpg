import assert from "node:assert/strict";
import test from "node:test";
import { uuidv7 } from "./uuid-v7";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("연달아 만든 1000개는 문자열로 엄격히 증가한다 — 이것이 이 모듈의 존재 이유다", () => {
  const ids = Array.from({ length: 1000 }, () => uuidv7());
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(
      ids[i] > ids[i - 1],
      `${i}번째가 앞 것보다 작거나 같다: ${ids[i - 1]} → ${ids[i]}\n` +
        "같은 밀리초 안에서 순서가 뒤집히면 '최근 N 줄'이 다시 비결정적이 된다.",
    );
  }
  assert.equal(new Set(ids).size, 1000, "중복이 없다");
});

test("버전 니블은 7, variant 는 10, 형식은 UUID", () => {
  for (let i = 0; i < 100; i += 1) {
    const id = uuidv7();
    assert.match(id, UUID_RE, id);
    assert.equal(id[14], "7", `버전 니블이 7 이 아니다: ${id}`);
    assert.ok("89ab".includes(id[19]), `variant 비트가 10 이 아니다: ${id}`);
  }
});

test("앞 48비트는 현재 유닉스 밀리초다 — 정렬 키가 곧 시각이다", () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();
  const ms = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  assert.ok(ms >= before && ms <= after + 1, `${ms} 이 [${before}, ${after}] 밖이다`);
});
