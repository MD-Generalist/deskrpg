import test from "node:test";
import assert from "node:assert/strict";
import type { TiledMap } from "../../lib/tiled-map";
import { tiledSnapshot } from "../three/tiled-preview";
import { buildOfficeEnvironment } from "../three/office-environments";
import { loadLegacyRuntime, loadTiledRuntime, occupiedTiles } from "./map-runtime";

const map = {
  width: 4,
  height: 3,
  tilewidth: 32,
  tileheight: 32,
  layers: [
    { id: 1, name: "Floor", type: "tilelayer", data: Array(12).fill(1) },
    // 뒤집기 플래그(상위 비트)가 붙은 GID 도 논리 타일 번호로 읽는다.
    { id: 2, name: "Walls", type: "tilelayer", data: [0x80000002, ...Array(11).fill(0)] },
    { id: 3, name: "Collision", type: "tilelayer", data: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    {
      id: 4,
      name: "Objects",
      type: "objectgroup",
      objects: [
        { id: 1, name: "spawn", type: "spawn", x: 32, y: 32 },
        { id: 2, name: "desk", type: "desk", x: 64, y: 32 },
        { id: 3, name: "chair", type: "chair", x: 32, y: 32 },
        {
          id: 4,
          name: "table",
          type: "meeting_table",
          x: 64,
          y: 64,
          properties: [{ name: "direction", value: "left" }],
        },
      ],
    },
    {
      id: 5,
      name: "Collision",
      type: "objectgroup",
      objects: [{ id: 5, x: 32, y: 0, width: 16, height: 32 }],
    },
  ],
  tilesets: [],
} as unknown as TiledMap;

test("Tiled 런타임은 미리보기 스냅샷과 같은 기하·차단 타일을 낸다", () => {
  const runtime = loadTiledRuntime(map as unknown as Record<string, unknown>);
  const preview = tiledSnapshot(map);
  assert.equal(runtime.cols, preview.cols);
  assert.equal(runtime.rows, preview.rows);
  assert.deepEqual([...occupiedTiles(runtime)].sort(), [...preview.blocked].sort());
  assert.deepEqual(
    runtime.objects.map((o) => [o.id, o.type, o.col, o.row, o.direction]),
    preview.objects.map((o) => [o.id, o.type, o.col, o.row, o.direction]),
  );
  assert.equal(runtime.walls[0][0], 2, "flip flags are stripped from the wall GID");
  assert.deepEqual(runtime.collision[0], [1, 0, 0, 0]);
  assert.deepEqual(runtime.tiledSpawn, { col: 1, row: 1 });
  assert.equal(runtime.tiled, true);
});

test("공식 환경 맵은 환경 id·버전·산책 구역을 함께 읽는다", () => {
  const source = buildOfficeEnvironment("agency");
  const runtime = loadTiledRuntime(source as unknown as Record<string, unknown>);
  const preview = tiledSnapshot(source);
  assert.equal(runtime.environment, preview.environment);
  assert.equal(runtime.environmentVersion, preview.environmentVersion);
  assert.deepEqual([...occupiedTiles(runtime)].sort(), [...preview.blocked].sort());
  assert.ok(runtime.ambientZones.length > 0);
});

test("레거시 맵은 벽 타일이 충돌이고 오브젝트 점유만 차단한다", () => {
  const runtime = loadLegacyRuntime({
    layers: {
      floor: [
        [1, 1, 1],
        [1, 1, 1],
      ],
      walls: [
        [2, 0, 0],
        [0, 0, 0],
      ],
    },
    objects: [{ id: "d", type: "desk", col: 1, row: 1 }],
  });
  assert.equal(runtime.tiled, false);
  assert.deepEqual([runtime.cols, runtime.rows], [3, 2]);
  assert.equal(runtime.walls[0][0], 2);
  assert.ok(occupiedTiles(runtime).has("1,1"));
  assert.ok(
    !occupiedTiles(runtime).has("0,0"),
    "legacy walls are judged by isWalkable, not occupancy",
  );
});

test("오브젝트가 바뀌어도 collision 레이어 셀은 점유 집합에 남는다", () => {
  const runtime = loadTiledRuntime(map as unknown as Record<string, unknown>);
  runtime.objects = [];
  assert.ok(occupiedTiles(runtime).has("0,0"));
  assert.ok(occupiedTiles(runtime).has("1,0"));
  assert.ok(!occupiedTiles(runtime).has("2,1"));
});
