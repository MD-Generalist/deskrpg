import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_SPEC, SCENES, capturePaths, validateProbe } from "./contracts";

test("declares exactly the four approved README scenes", () => {
  assert.deepEqual(SCENES, ["home-commute", "walk-report", "small-talk", "ai-meeting"]);
});

test("builds committed and ignored paths separately", () => {
  const paths = capturePaths("/repo", "small-talk");
  assert.equal(paths.gif, "/repo/public/readme/deskrpg-small-talk.gif");
  assert.equal(paths.master, "/repo/.artifacts/readme-capture/masters/small-talk.mp4");
});

test("rejects media outside the approved dimensions, duration and size", () => {
  assert.throws(() =>
    validateProbe(
      "ai-meeting",
      { width: 960, height: 500, fps: 12, duration: 9, loop: "forever" },
      1_000,
    ),
  );
  assert.doesNotThrow(() =>
    validateProbe(
      "ai-meeting",
      {
        width: MEDIA_SPEC.gif.width,
        height: MEDIA_SPEC.gif.height,
        fps: 12,
        duration: 9,
        loop: "forever",
      },
      8_000_000,
    ),
  );
});

test("rejects a non-looping GIF", () => {
  assert.throws(() =>
    validateProbe(
      "ai-meeting",
      { width: MEDIA_SPEC.gif.width, height: MEDIA_SPEC.gif.height, fps: 12, duration: 9, loop: 1 },
      8_000_000,
    ),
  );
});
