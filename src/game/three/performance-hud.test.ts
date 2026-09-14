import assert from "node:assert/strict";
import test from "node:test";
import { showPerformanceHud } from "./performance-hud";

test("performance HUD remains on in ordinary development and off in capture and production", () => {
  assert.equal(showPerformanceHud("development", undefined), true);
  assert.equal(showPerformanceHud("development", "0"), true);
  assert.equal(showPerformanceHud("development", "1"), false);
  assert.equal(showPerformanceHud("production", undefined), false);
});
