import test from "node:test";
import assert from "node:assert/strict";
import { parseMotionContinuation } from "./npc-motion-continuation";
const valid = {
  ambientSchedule: { phase: "roam", elapsed: 1000, duration: 25000, pause: 600 },
  ambientTimer: 200,
  ambientSeat: { x: 1, y: 1 },
  path: [{ x: 4, y: 4 }],
};

test("motion continuation rejects malformed phases, unbounded payloads and off-map coordinates", () => {
  for (const patch of [
    { ambientSchedule: { ...valid.ambientSchedule, phase: ["roam"] } },
    { ambientSchedule: { ...valid.ambientSchedule, elapsed: -1 } },
    { ambientSchedule: { ...valid.ambientSchedule, duration: Infinity } },
    { ambientSchedule: { ...valid.ambientSchedule, seatRest: 86_400_001 } },
    { ambientSchedule: { ...valid.ambientSchedule, seatTarget: { x: 16, y: 2 } } },
    { ambientTimer: NaN },
    { ambientSeat: { x: -1, y: 1 } },
    { path: Array.from({ length: 257 }, () => ({ x: 4, y: 4 })) },
    { path: [{ x: 4, y: 16 }] },
    { path: [null] },
  ])
    assert.equal(
      parseMotionContinuation({ ...valid, ...patch }, { width: 512, height: 512 }).ok,
      false,
      JSON.stringify(patch),
    );
});

test("motion continuation copies only validated data and distinguishes omission from explicit reset", () => {
  assert.deepEqual(parseMotionContinuation(undefined), { ok: true, value: undefined });
  assert.deepEqual(parseMotionContinuation(null), { ok: true, value: null });
  const result = parseMotionContinuation(
    { ...valid, extra: "not part of protocol" },
    { width: 512, height: 512 },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value, valid);
  valid.path[0].x = 9;
  assert.equal(result.value!.path![0].x, 4);
  valid.path[0].x = 4;
});
