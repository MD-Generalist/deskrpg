import assert from "node:assert/strict";
import test from "node:test";
import { meetingCaptureOffset } from "./capture-camera";

test("meeting capture pointer offset is restrained and returns to the fixed center", () => {
  assert.deepEqual(meetingCaptureOffset(0, 0, "development", "1"), { yaw: 0, lift: 0 });
  assert.deepEqual(meetingCaptureOffset(1, -1, "development", "1"), { yaw: 0.14, lift: -0.025 });
  assert.deepEqual(meetingCaptureOffset(100, -100, "development", "1"), {
    yaw: 0.14,
    lift: -0.025,
  });
});

test("ordinary development and every production capture flag keep the camera fixed", () => {
  for (const [mode, flag] of [
    ["development", undefined],
    ["development", "0"],
    ["production", "1"],
    ["production", undefined],
    ["test", "1"],
  ])
    assert.deepEqual(meetingCaptureOffset(1, 1, mode, flag), { yaw: 0, lift: 0 });
});
