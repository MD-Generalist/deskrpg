import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";
import { buildTradingAsset, TRADING_ASSETS } from "./trading-assets";
import { SCENE_ASSETS } from "./scene-asset-definitions";
for (const id of Object.keys(TRADING_ASSETS) as (keyof typeof TRADING_ASSETS)[]) {
  test(`${id}: exported shared asset fits logical footprint and PBR budget`, () => {
    const root = buildTradingAsset(id),
      bounds = new T.Box3().setFromObject(root),
      size = bounds.getSize(new T.Vector3()),
      def = TRADING_ASSETS[id];
    assert.ok(size.x <= def.footprint[0] + 0.01);
    assert.ok(size.z <= def.footprint[1] + 0.01);
    assert.ok(bounds.min.y >= -0.001);
    const entry = SCENE_ASSETS[id];
    const file = readFileSync(`public${entry.url}`);
    assert.equal(file.readUInt32LE(0), 0x46546c67);
    assert.ok(file.length < entry.budget.maxBytes);
    const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    assert.ok(json.textures.length >= 3);
    assert.ok(json.materials.some((m: { normalTexture?: unknown }) => m.normalTexture));
    assert.deepEqual(entry.footprint, def.footprint);
  });
}
