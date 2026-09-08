import assert from "node:assert/strict";
import test from "node:test";

import { isUniqueViolation } from "./db-unique-violation";

test("pg 와 sqlite 의 unique 위반을 모두 알아본다", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" }), true);
  assert.equal(isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }), true);
});

test("다른 오류는 통과시키지 않는다", () => {
  assert.equal(isUniqueViolation({ code: "23503" }), false);
  assert.equal(isUniqueViolation(new Error("boom")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation("23505"), false);
});
