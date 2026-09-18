import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { ALL_PLANS, isRemoved, addedNodeName } from "./wardrobe-plan";

const dir = "public/assets/characters/office";
// Sum of the 50 office GLBs at commit 41ac7639 (the source snapshot art/wardrobe-fit/source/ is
// built from before fitting; see the "Rerun" section of wardrobe_fit.py's module docstring).
const SOURCE_TOTAL_BYTES = 21_755_352;

const nodes = (id: string) => {
  const b = readFileSync(`${dir}/${id}.glb`);
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return {
    names: (j.nodes as { name?: string; mesh?: number }[])
      .filter((n) => n.mesh !== undefined)
      .map((n) => n.name ?? ""),
    clips: (j.animations as { name: string }[]).map((a) => a.name).sort(),
  };
};

test("no shipped look keeps a floating wardrobe part and every planned fitted part exists", () => {
  for (const plan of ALL_PLANS) {
    const { names, clips } = nodes(plan.id);
    assert.deepEqual(clips, ["idle", "sit", "walk"], plan.id);
    for (const n of names) assert.ok(!isRemoved(plan, n), `${plan.id} still has ${n}`);
    for (const t of plan.add)
      assert.ok(names.includes(addedNodeName(plan, t)), `${plan.id} missing ${t}`);
  }
});

test("catalog stays small enough to ship", () => {
  const total = ALL_PLANS.reduce((s, p) => s + statSync(`${dir}/${p.id}.glb`).size, 0);
  assert.ok(total <= SOURCE_TOTAL_BYTES * 1.1, `total ${total}`);
});
