import assert from "node:assert/strict";
import test from "node:test";

import { reviewImplementer } from "./review-implementer";

const submitted = (implementer: string, at: number) => ({
  id: `e${at}`,
  kind: "review_requested",
  payload: { implementer },
  created_at: at,
});
const run = (profile: string, at: number) => ({
  id: `r${at}`,
  profile,
  status: "done",
  started_at: at,
  ended_at: at + 1,
});

test("the first submission's implementer is the one who did the work, not the reviewer's verdict", () => {
  const detail = {
    events: [submitted("sophie", 1), submitted("oliver", 5)],
    runs: [run("sophie", 1), run("oliver", 5)],
  };
  assert.equal(reviewImplementer(detail, "oliver"), "sophie");
});

test("without a recorded submission, the latest run by someone other than the reviewer", () => {
  const detail = { events: [], runs: [run("mia", 1), run("sophie", 3), run("oliver", 9)] };
  assert.equal(reviewImplementer(detail, "oliver"), "sophie");
});

test("with only the reviewer's runs, or no policy reviewer, the latest run's profile", () => {
  assert.equal(reviewImplementer({ events: [], runs: [run("oliver", 2)] }, "oliver"), "oliver");
  assert.equal(
    reviewImplementer({ events: [], runs: [run("mia", 1), run("sophie", 4)] }, null),
    "sophie",
  );
});

test("nothing to go on is null", () => {
  assert.equal(reviewImplementer({ events: [], runs: [] }, "oliver"), null);
  assert.equal(
    reviewImplementer(
      { events: [{ ...submitted("", 1) }], runs: [{ id: "r", status: "done" }] },
      null,
    ),
    null,
  );
});
