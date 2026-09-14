import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { officeLighting, shadowExtent } from "./office-lighting";
test("agency has broad warm daylight and restrained exposure; legacy retains prior profile", () => {
  const studio = officeLighting("agency", 3);
  assert.equal(studio.sun, "#ffe7ce");
  assert.equal(studio.exposure, 1.08);
  assert.ok(studio.fillIntensity >= 0.8);
  assert.equal(studio.shadowMapType, T.PCFShadowMap);
  assert.equal(officeLighting("agency", 2).shadowMapType, T.PCFSoftShadowMap);
  assert.ok(studio.shadowRadius > 1);
  assert.equal(officeLighting("agency", 2).exposure, 1.05);
  assert.equal(officeLighting("executive").exposure, 1.12);
  assert.ok(shadowExtent(42, 26) > 28);
});

test("changing shadow filter recompiles retained actor materials, while an unchanged filter is inert", async () => {
  const { applyOfficeShadowFilter } = await import("./office-lighting");
  assert.equal(typeof applyOfficeShadowFilter, "function");
  const material = new T.MeshStandardMaterial();
  const scene = new T.Scene().add(new T.Mesh(new T.BoxGeometry(), material));
  const shadowMap = { type: T.PCFSoftShadowMap as T.ShadowMapType };
  const start = material.version;
  applyOfficeShadowFilter(scene, shadowMap, T.PCFShadowMap);
  assert.equal(material.version, start + 1);
  applyOfficeShadowFilter(scene, shadowMap, T.PCFShadowMap);
  assert.equal(material.version, start + 1);
  applyOfficeShadowFilter(scene, shadowMap, T.PCFSoftShadowMap);
  assert.equal(material.version, start + 2);
});
