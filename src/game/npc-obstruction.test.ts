import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { clearSegment, type NavigationPoint, type Walkable } from "./navigation";
import { findTrafficPath, TrafficCoordinator, clearActors } from "./traffic";
import { findTaggedDestinationPath, readAmbientZones } from "./ambient-zones";
import { buildOfficeEnvironment } from "./three/office-environments";
import { tiledSnapshot } from "./three/tiled-preview";

type NpcPathfinder = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  valid: Walkable,
) => NavigationPoint[] | null;

// Execute the real controller without starting a WebGL/Phaser scene in node.
const source = readFileSync(new URL("./scenes/GameScene.ts", import.meta.url), "utf8");
const controller = source.slice(
  source.indexOf("class NpcSprite {"),
  source.indexOf("// GameScene\n"),
);
const code = ts.transpileModule(`${controller}\nglobalThis.Controller = NpcSprite;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
type RuntimeNpc = {
  pixelX: number;
  pixelY: number;
  moveState: string;
  actuallyWalking: boolean;
  currentPath: NavigationPoint[] | null;
  destinationTag: string | null;
  destinationTarget: NavigationPoint | null;
  purposeAccessOrigin: NavigationPoint | null;
  updateMovement(
    delta: number,
    playerX: number,
    playerY: number,
    plan: NpcPathfinder,
    valid: Walkable,
    step?: (p: NavigationPoint, goal: NavigationPoint, amount: number) => NavigationPoint,
  ): string;
};
const scope: Record<string, unknown> = {
  Phaser: { GameObjects: { Sprite: class {} } },
  TILE_SIZE: 32,
  clearSegment,
  clearActors,
  findTrafficPath,
  findTaggedDestinationPath,
  DIR_LEFT: 1,
  DIR_RIGHT: 2,
  DIR_UP: 3,
  DIR_DOWN: 0,
};
runInNewContext(code, scope);
function actor(state: string) {
  const npc = Object.create(
    (scope.Controller as { prototype: RuntimeNpc }).prototype,
  ) as RuntimeNpc;
  Object.assign(npc, {
    pixelX: 48,
    pixelY: 80,
    homeCol: 7,
    homeRow: 2,
    currentPath: [
      { x: 3, y: 2 },
      { x: 7, y: 2 },
    ],
    pathIndex: 0,
    moveState: state,
    trafficBlockedMs: 0,
    pathRecalcTimer: 0,
    stuckFrames: 0,
    lastDist: Infinity,
    actuallyWalking: true,
    moveSpeed: 150,
    sprite: { setPosition() {} },
    nameLabel: { setPosition() {} },
  });
  return npc;
}
const walkable = (x: number, y: number) => x >= 0 && x <= 8 && y >= 0 && y <= 4;
for (const state of ["strolling", "returning", "moving-to-player"]) {
  test(`${state}: stationary obstruction replans to the same goal and stops walking while waiting`, () => {
    const npc = actor(state);
    let replans = 0;
    const plan = (sx: number, sy: number, ex: number, ey: number, valid: typeof walkable) => {
      replans++;
      assert.deepEqual([ex, ey], [7, 2]);
      return findTrafficPath(sx, sy, ex, ey, valid, [{ x: 3, y: 2 }]);
    };
    for (let i = 0; i < 15; i++) {
      npc.updateMovement(100, 1000, 1000, plan, walkable, (p: NavigationPoint) => p);
      assert.equal(npc.actuallyWalking, false);
    }
    assert.equal(replans, 1);
    assert.equal(npc.moveState, state);
    assert.deepEqual(JSON.parse(JSON.stringify(npc.currentPath!.at(-1))), { x: 7, y: 2 });
    assert.ok(
      npc.currentPath!.some((p: NavigationPoint) => p.y !== 2),
      "detour leaves the blocked row",
    );
  });
}
test("unreachable stroll retains its seat goal and retries at a bounded interval", () => {
  const npc = actor("strolling");
  let replans = 0;
  for (let i = 0; i < 45; i++)
    npc.updateMovement(
      100,
      1000,
      1000,
      () => {
        replans++;
        return null;
      },
      walkable,
      (p: NavigationPoint) => p,
    );
  assert.equal(replans, 3);
  assert.equal(npc.actuallyWalking, false);
  assert.equal(npc.currentPath!.at(-1)!.x, 7);
  assert.equal(npc.moveState, "strolling");
});

test("stroll really passes a stationary player and reaches the original destination", () => {
  const npc = actor("strolling");
  const traffic = new TrafficCoordinator();
  const human = { id: "player", x: 3, y: 2, player: true };
  const plan = (sx: number, sy: number, ex: number, ey: number, valid: typeof walkable) =>
    findTrafficPath(sx, sy, ex, ey, valid, [human]);
  let detoured = false;
  for (let now = 0; now < 60000 && npc.moveState !== "idle"; now += 50) {
    const before = { x: npc.pixelX / 32 - 0.5, y: npc.pixelY / 32 - 0.5 };
    npc.updateMovement(
      50,
      1000,
      1000,
      plan,
      walkable,
      (p: NavigationPoint, goal: NavigationPoint, amount: number) =>
        traffic.step("npc", p, goal, amount, now, walkable, [human, { id: "npc", ...p }]),
    );
    const after = { x: npc.pixelX / 32 - 0.5, y: npc.pixelY / 32 - 0.5 };
    assert.ok(clearActors(before, after, [human]), "never pass through the player");
    detoured ||= Math.abs(after.y - 2) > 0.4;
  }
  assert.equal(npc.moveState, "idle");
  assert.ok(detoured);
  assert.ok(Math.hypot(npc.pixelX / 32 - 0.5 - 7, npc.pixelY / 32 - 0.5 - 2) < 0.1);
});

const pathfinderSource = source.slice(
  source.indexOf("  private npcPathfinder("),
  source.indexOf("  private createNpcWalkValidator("),
);
const pathfinderCode = ts.transpileModule(
  `class PathController { ${pathfinderSource} }\nglobalThis.PathController = PathController;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
runInNewContext(pathfinderCode, scope);

test("tagged retry starts at the current tile and keeps the fixed purpose destination", () => {
  const map = buildOfficeEnvironment("agency");
  const snapshot = tiledSnapshot(map);
  const zones = readAmbientZones(map as unknown as Record<string, unknown>);
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 1 && x < snapshot.cols - 1 && y >= 1 && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const runtime = Object.assign(
    new (
      scope.PathController as new () => {
        npcPathfinder(npc: RuntimeNpc): NpcPathfinder;
      }
    )(),
    { ambientZones: zones, trafficActors: () => [] },
  );
  const npc = actor("moving-to-player");
  Object.assign(npc, {
    pixelX: (11 + 0.5) * 32,
    pixelY: (15 + 0.5) * 32,
    currentPath: null,
    pathRecalcTimer: 900,
    destinationTag: "photo",
    destinationTarget: { x: 5, y: 8 },
    purposeAccessOrigin: { x: 23, y: 23 },
  });
  const plan = runtime.npcPathfinder(npc);

  npc.updateMovement(100, 1000, 1000, plan, walkable);
  assert.deepEqual(JSON.parse(JSON.stringify(npc.currentPath?.[0])), { x: 11, y: 15 });
  assert.notDeepEqual(JSON.parse(JSON.stringify(npc.currentPath?.[0])), { x: 23, y: 23 });
  assert.deepEqual(JSON.parse(JSON.stringify(npc.currentPath?.at(-1))), { x: 5, y: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(npc.destinationTarget)), { x: 5, y: 8 });
  assert.equal(npc.destinationTag, "photo");

  for (let frame = 0; frame < 300 && npc.moveState !== "waiting"; frame++) {
    const before = { x: npc.pixelX / 32 - 0.5, y: npc.pixelY / 32 - 0.5 };
    npc.updateMovement(50, 1000, 1000, plan, walkable);
    const after = { x: npc.pixelX / 32 - 0.5, y: npc.pixelY / 32 - 0.5 };
    assert.ok(clearSegment(before, after, walkable), `body-clear retry frame ${frame}`);
  }
  assert.equal(npc.moveState, "waiting");
  assert.ok(Math.hypot(npc.pixelX / 32 - 0.5 - 5, npc.pixelY / 32 - 0.5 - 8) < 0.1);
});
