import { test } from "node:test";
import assert from "node:assert/strict";
import { NpcSmalltalk } from "./npc-smalltalk";
const actors = () => [
  { id: "a", name: "노아", x: 1, y: 1, walking: true, available: true },
  { id: "b", name: "미나 · 기획", x: 2, y: 1, walking: false, available: true },
];
test("named exchange is staggered, expires, and avoids immediate template repetition", () => {
  const talk = new NpcSmalltalk();
  talk.update(
    actors(),
    0,
    () => true,
    () => 0,
  );
  const first = talk.text("a", 0);
  assert.match(first!, /미나님/);
  assert.equal(talk.text("b", 0), undefined);
  assert.match(talk.text("b", 2000)!, /노아님/);
  assert.equal(talk.text("a", 6500), undefined);
  talk.update(
    actors(),
    50000,
    () => true,
    () => 0,
  );
  assert.equal(talk.text("a", 50000), undefined);
  talk.update(
    actors(),
    90000,
    () => true,
    () => 0,
  );
  assert.notEqual(talk.text("a", 90000), first);
});
test("busy staff, stationary pairs, distant staff and walls do not trigger greetings", () => {
  for (const condition of ["busy", "still", "far", "wall"]) {
    const talk = new NpcSmalltalk(),
      people = actors();
    if (condition === "busy") people[1].available = false;
    if (condition === "still") people[0].walking = false;
    if (condition === "far") people[1].x = 20;
    talk.update(people, 0, () => condition !== "wall");
    assert.equal(talk.text("a", 0), undefined);
  }
});
test("real conversations cancel pending replies", () => {
  const talk = new NpcSmalltalk(),
    people = actors();
  talk.update(people, 0, () => true);
  people[1].available = false;
  talk.update(people, 1000, () => true);
  assert.equal(talk.text("b", 2000), undefined);
});
test("both participants stay through the reply and resume together after 7.5 seconds", () => {
  const talk = new NpcSmalltalk(),
    people = actors();
  talk.update(people, 0, () => true);
  assert.equal(talk.partner("a", 0), "b");
  assert.equal(talk.partner("b", 0), "a");
  people[0].walking = false;
  talk.update(people, 6500, () => true);
  assert.equal(talk.text("b", 6500), undefined);
  assert.equal(talk.partner("a", 7499), "b");
  assert.equal(talk.partner("b", 7499), "a");
  talk.update(people, 7500, () => true);
  assert.equal(talk.partner("a", 7500), undefined);
  assert.equal(talk.partner("b", 7500), undefined);
});
test("a call or removal releases both participants immediately, including delayed reply", () => {
  for (const removed of [false, true]) {
    const talk = new NpcSmalltalk(),
      people = actors();
    talk.update(people, 0, () => true);
    if (removed) people.pop();
    else people[1].available = false;
    talk.update(people, 1000, () => true);
    assert.equal(talk.partner("a", 1000), undefined);
    assert.equal(talk.partner("b", 1000), undefined);
    assert.equal(talk.text("a", 1000), undefined);
    assert.equal(talk.text("b", 2000), undefined);
  }
});
