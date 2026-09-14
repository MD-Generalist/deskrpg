/** Validate packaged catalog coverage and animation contracts without a running app.
 * npx tsx tools/characters/validate_office_catalog.ts [gltf-validator module path]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { OFFICE_LOOKS } from "../../src/game/three/office-looks";

type GltfDocument = {
  asset: { version: string };
  buffers: { uri?: string }[];
  images?: { uri?: string }[];
  skins?: unknown[];
  nodes?: { name?: string; scale?: number[] }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
  accessors: {
    count: number;
    min?: number[];
    max?: number[];
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    type: string;
  }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
};

async function main() {
  const validator = process.argv[2]
    ? createRequire(import.meta.url)(resolve(process.argv[2]))
    : undefined;
  const results = [];
  for (const look of OFFICE_LOOKS) {
    const path = `public/assets/characters/office/${look.id}.glb`;
    const bytes = readFileSync(path);
    assert.equal(bytes.toString("ascii", 0, 4), "glTF", path);
    assert.equal(bytes.readUInt32LE(4), 2, path);
    assert.equal(bytes.readUInt32LE(8), bytes.length, path);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, path);
    const gltf: GltfDocument = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(gltf.asset.version, "2.0", path);
    assert.ok(gltf.skins?.length, `${path}: skinned rig required`);
    assert.ok(
      gltf.buffers.every((b) => !b.uri),
      `${path}: GLB must be self-contained`,
    );
    assert.ok(
      (gltf.images ?? []).every((i) => !i.uri || i.uri.startsWith("data:")),
      path,
    );
    assert.deepEqual(gltf.animations.map((a) => a.name).sort(), ["idle", "sit", "walk"], path);
    const scaleByNode = new Map<number, number[]>();
    const binStart = 20 + bytes.readUInt32LE(12) + 8;
    for (const clip of gltf.animations) {
      assert.ok(clip.channels.length > 0, `${path}: empty ${clip.name}`);
      for (const sampler of clip.samplers) {
        const time = gltf.accessors[sampler.input];
        assert.ok(
          time.count >= 2 && time.max?.[0] && time.max[0] > 0,
          `${path}: ${clip.name} duration`,
        );
      }
      // Scale changes between poses produce a visible height jump during crossfade.
      // All character clips must use the same authored skeletal proportions.
      for (const channel of clip.channels.filter((c) => c.target.path === "scale")) {
        const sampler = clip.samplers[channel.sampler];
        assert.notEqual(
          sampler.interpolation,
          "CUBICSPLINE",
          `${path}: review scale spline explicitly`,
        );
        const accessor = gltf.accessors[sampler.output];
        assert.equal(accessor.componentType, 5126, path);
        assert.equal(accessor.type, "VEC3", path);
        const view = gltf.bufferViews[accessor.bufferView];
        const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        for (let frame = 0; frame < accessor.count; frame++) {
          const value = [0, 1, 2].map((axis) =>
            bytes.readFloatLE(start + frame * (view.byteStride ?? 12) + axis * 4),
          );
          const reference = scaleByNode.get(channel.target.node) ?? value;
          assert.ok(
            value.every((v, axis) => Number.isFinite(v) && Math.abs(v - reference[axis]) < 0.001),
            `${path}: ${gltf.nodes?.[channel.target.node]?.name} changes scale in ${clip.name}`,
          );
          scaleByNode.set(channel.target.node, reference);
        }
      }
    }
    let triangles = 0;
    for (const mesh of gltf.meshes)
      for (const primitive of mesh.primitives) {
        const positions = gltf.accessors[primitive.attributes.POSITION];
        assert.ok(
          positions.count > 0 &&
            positions.min?.every(Number.isFinite) &&
            positions.max?.every(Number.isFinite),
          path,
        );
        triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
      }
    const validation = validator
      ? await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 })
      : undefined;
    assert.equal(validation?.issues.numErrors ?? 0, 0, `${path}: glTF validation errors`);
    results.push({
      id: look.id,
      name: look.name,
      bodyType: look.bodyType,
      outfit: look.outfit,
      bytes: bytes.length,
      triangles,
      nodes: gltf.nodes?.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      errors: validation?.issues.numErrors ?? null,
      warnings: validation?.issues.numWarnings ?? null,
      warningCodes: validation
        ? [
            ...new Set(
              validation.issues.messages
                .filter((m: { severity: number }) => m.severity === 1)
                .map((m: { code: string }) => m.code),
            ),
          ]
        : [],
    });
  }
  assert.equal(
    new Set(results.map((r) => r.sha256)).size,
    OFFICE_LOOKS.length,
    "Duplicate model files",
  );
  const report = {
    generatedAt: new Date().toISOString(),
    count: results.length,
    totalBytes: results.reduce((s, r) => s + r.bytes, 0),
    validator: !!validator,
    results,
  };
  mkdirSync("art/characters/office-catalog", { recursive: true });
  writeFileSync(
    "art/characters/office-catalog/validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      count: report.count,
      totalBytes: report.totalBytes,
      validator: report.validator,
      errors: results.reduce((s, r) => s + (r.errors ?? 0), 0),
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
