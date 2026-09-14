import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerResumeStore } from "./player-resume-state";
const identity = { userId: "user-a", characterId: "char-a", mapId: "room-a" };
const state = {
  ...identity,
  x: 512.125,
  y: 320.25,
  direction: "left",
  animation: "walk",
  motion: { targetX: 600, targetY: 400 },
};
test("refresh restores exact position and click destination independently of socket id", () => {
  const store = new PlayerResumeStore();
  store.save(state);
  assert.deepEqual(store.get(identity), {
    x: 512.125,
    y: 320.25,
    direction: "left",
    animation: "walk",
    motion: { targetX: 600, targetY: 400 },
  });
  assert.equal(store.get({ ...identity, userId: "user-b" }), undefined);
  assert.equal(store.get({ ...identity, characterId: "char-b" }), undefined);
  assert.equal(store.get({ ...identity, mapId: "room-b" }), undefined);
});
test("stop clears the previous destination and returned state cannot mutate authority", () => {
  const store = new PlayerResumeStore();
  store.save(state);
  store.save({ ...state, animation: "idle", motion: null });
  const saved = store.get(identity)!;
  assert.equal(saved.motion, null);
  saved.x = 0;
  assert.equal(store.get(identity)?.x, 512.125);
});
test("invalid coordinates and malformed destination never poison a resume snapshot", () => {
  const store = new PlayerResumeStore();
  store.save(state);
  store.save({ ...state, x: NaN });
  assert.equal(store.get(identity)?.x, 512.125);
  store.save({ ...state, motion: { targetX: Infinity, targetY: 5 } });
  assert.equal(store.get(identity)?.motion, null);
});
test("idle snapshots expire and bounded cache evicts oldest identity", () => {
  let now = 0;
  const store = new PlayerResumeStore({ now: () => now, ttlMs: 100, maxEntries: 2 });
  store.save(state);
  now = 1;
  store.save({ ...state, userId: "b" });
  now = 2;
  store.save({ ...state, userId: "c" });
  assert.equal(store.get(identity), undefined);
  now = 103;
  assert.equal(store.get({ ...identity, userId: "c" }), undefined);
});

test("map refresh discards only the affected channel destinations", () => {
  const store = new PlayerResumeStore();
  store.save(state);
  store.save({ ...state, mapId: "other" });
  store.clearChannel(identity.mapId);
  assert.equal(store.get(identity), undefined);
  assert.equal(store.get({ ...identity, mapId: "other" })?.motion?.targetX, 600);
});
