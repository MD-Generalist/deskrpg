import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "./three/office-environments";
import { withRuntimeTileset } from "./tiled-runtime";

test("모든 공식 맵의 양수 타일 GID가 런타임 타일셋 안에 존재한다", () => {
  for (const { id } of OFFICE_ENVIRONMENTS) {
    const source = buildOfficeEnvironment(id);
    const before = JSON.stringify(source);
    const runtime = withRuntimeTileset(source as unknown as Record<string, unknown>);
    const sets = runtime.tilesets as { firstgid: number; tilecount: number }[];
    for (const layer of source.layers)
      for (const gid of layer.data ?? []) {
        if (gid > 0)
          assert.ok(
            sets.some((s) => gid >= s.firstgid && gid < s.firstgid + s.tilecount),
            `${id}: ${gid}`,
          );
      }
    assert.equal(JSON.stringify(source), before);
    assert.equal(runtime.layers, source.layers);
  }
});
test("사용자 타일셋은 교체하지 않는다", () => {
  const map = { tilesets: [{ firstgid: 1, source: "custom.tsx" }] };
  assert.equal(withRuntimeTileset(map), map);
});
