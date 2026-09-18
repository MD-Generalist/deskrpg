import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_LOOKS } from "../../src/game/three/office-looks";
import { planFor, isRemoved, addedNodeName, ALL_PLANS, hasMaleTurtleneck } from "./wardrobe-plan";

const look = (id: string) => OFFICE_LOOKS.find((l) => l.id === id)!;

test("male suit with shoulder bag replaces collar, inset, lapels and bag", () => {
  const p = planFor(look("office-jun"));
  assert.equal(p.body, "male");
  for (const n of [
    "Collar",
    "Collar.001",
    "Shirt inset",
    "Tailored lapel.001",
    "Shoulder satchel",
    "Shoulder strap",
  ])
    assert.ok(isRemoved(p, n), n);
  for (const n of ["Tie", "ID badge", "Button.002", "Human_Mesh", "Jacket pocket"])
    assert.ok(!isRemoved(p, n), n);
  assert.deepEqual([...p.add].sort(), ["lapel", "shirt_collar", "shirt_v", "shoulder_bag"]);
  assert.equal(p.skirt, null);
});

test("female bow + skirt removes bow spheres and neck ring, fixes skirt", () => {
  const p = planFor(look("office-daeun"));
  assert.equal(p.body, "female");
  for (const n of ["office-daeun_bow", "office-daeun_bow.001", "office-daeun_Neckwear"])
    assert.ok(isRemoved(p, n), n);
  for (const n of ["office-daeun_Top", "office-daeun_HandNotebook", "office-daeun_ContinuousSkirt"])
    assert.ok(!isRemoved(p, n), n);
  assert.deepEqual(p.add, ["bow"]);
  assert.equal(p.skirt, "office-daeun_ContinuousSkirt");
});

test("turtleneck keeps the neck ring", () => {
  const t = OFFICE_LOOKS.find((l) => l.bodyType === "female" && l.neckwear === "turtleneck")!;
  assert.ok(!isRemoved(planFor(t), `${t.id}_Neckwear`));
});

test("backpack looks get the backpack template on both bodies", () => {
  for (const l of OFFICE_LOOKS.filter((x) => x.bag === "backpack")) {
    const p = planFor(l);
    assert.ok(p.add.includes("backpack"), l.id);
    assert.ok(
      isRemoved(p, l.bodyType === "male" ? "Backpack strap.001" : `${l.id}_BackpackStrap`),
      l.id,
    );
  }
});

test("hoodies get no collar; vests get vest_v; all 50 planned with stable names", () => {
  for (const l of OFFICE_LOOKS.filter((x) => x.outfit === "hoodie"))
    assert.ok(!planFor(l).add.includes("shirt_collar"), l.id);
  for (const l of OFFICE_LOOKS.filter((x) => x.outfit === "vest" && x.bodyType === "male"))
    assert.ok(planFor(l).add.includes("vest_v"), l.id);
  assert.equal(ALL_PLANS.length, 50);
  assert.equal(addedNodeName(planFor(look("office-jun")), "lapel"), "office-jun_Fit_lapel");
});

test("male turtleneck looks drop the old collar but get no standing shirt collar", () => {
  const ids = OFFICE_LOOKS.filter(hasMaleTurtleneck)
    .map((l) => l.id)
    .sort();
  assert.deepEqual(ids, ["office-jaewon", "office-jin", "office-roan"]);
  for (const id of ids) {
    const p = planFor(look(id));
    assert.ok(isRemoved(p, "Collar") && isRemoved(p, "Collar.001"), id);
    assert.ok(!isRemoved(p, "Turtleneck"), id);
    assert.ok(!p.add.includes("shirt_collar"), id);
    assert.ok(p.add.includes("shirt_v") && p.add.includes("lapel"), id);
  }
  assert.ok(planFor(look("office-jun")).add.includes("shirt_collar"));
});

test("female turtleneck looks are unaffected by the male turtleneck rule", () => {
  for (const l of OFFICE_LOOKS.filter(
    (x) => x.bodyType === "female" && x.neckwear === "turtleneck",
  )) {
    const p = planFor(l);
    assert.ok(!hasMaleTurtleneck(l), l.id);
    assert.ok(!isRemoved(p, `${l.id}_Neckwear`), l.id);
    assert.ok(!p.add.includes("shirt_collar"), l.id);
  }
  assert.deepEqual(planFor(look("office-sera")).add, ["lapel", "backpack"]);
});
