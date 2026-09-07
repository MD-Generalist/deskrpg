import assert from "node:assert/strict";
import test from "node:test";

import { generateChannelInviteCode } from "./invite-code";

test("channel invite codes are long, URL-safe, and not decimal-base36 Math.random output", () => {
  const code = generateChannelInviteCode();
  assert.match(code, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(code.includes("."), false);
});

test("channel invite codes are not reused across successive generations", () => {
  const generated = new Set(Array.from({ length: 8 }, () => generateChannelInviteCode()));
  assert.equal(generated.size, 8);
});
