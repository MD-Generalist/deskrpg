import assert from "node:assert/strict";
import test from "node:test";

import { showGatewayPicker } from "./gateway-picker-visibility";

test("게이트웨이가 둘 이상일 때만 선택기를 보인다", () => {
  assert.equal(showGatewayPicker(0), false);
  assert.equal(showGatewayPicker(1), false);
  assert.equal(showGatewayPicker(2), true);
});
