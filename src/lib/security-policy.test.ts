import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  CHANNEL_PASSWORD_MIN_LENGTH,
  isAccountPasswordValid,
  isChannelPasswordValid,
} from "./security-policy";

test("account and channel passwords require at least eight characters", () => {
  assert.equal(ACCOUNT_PASSWORD_MIN_LENGTH, 8);
  assert.equal(CHANNEL_PASSWORD_MIN_LENGTH, 8);
  assert.equal(isAccountPasswordValid("1234567"), false);
  assert.equal(isAccountPasswordValid("12345678"), true);
  assert.equal(isChannelPasswordValid("1234567"), false);
  assert.equal(isChannelPasswordValid("12345678"), true);
});
