import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment } from "./office-environments";
import {
  TECH_STARTUP_ENTRANCE,
  TECH_STARTUP_SIZE,
  TECH_STARTUP_ZONES,
} from "./tech-startup-layout";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { clearSegment, findPath } from "../navigation";
import { ambientTileAllowed, readAmbientZones } from "../ambient-zones";

test("tech reference preserves its long footprint and functional seat program", () => {
  const map = buildOfficeEnvironment("tech");
  assert.equal(map.width / map.height, 2.2);
  assert.deepEqual(TECH_STARTUP_SIZE, { cols: 44, rows: 20 });
  const objects = tiledSnapshot(map).objects;
  assert.equal(objects.filter((o) => o.variant === "tech-workstation").length, 16);
  assert.equal(objects.filter((o) => o.variant === "tech-server-rack").length, 2);
  assert.equal(objects.filter((o) => o.variant === "tech-phone-booth").length, 2);
  assert.equal(objects.filter((o) => o.variant === "tech-beanbag").length, 2);
  assert.equal(
    objects.filter((o) => o.type === "chair" && o.destinationTags?.includes("meeting")).length,
    6,
  );
  assert.equal(
    objects.filter((o) => o.type === "studio_stool" && o.destinationTags?.includes("pantry"))
      .length,
    5,
  );
  assert.equal(
    objects.filter((o) => o.type === "studio_stool" && o.destinationTags?.includes("collaboration"))
      .length,
    3,
  );
});

test("all tech seating anchors have body-clear routes from the shared entrance", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("tech"));
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < snapshot.cols && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const spawn = { col: TECH_STARTUP_ENTRANCE.spawnCol, row: TECH_STARTUP_ENTRANCE.spawnRow };
  const seats = furnitureSeats(snapshot.objects);
  assert.ok(seats.length === 40, "22 chairs, 10 stools, 6 sofa places and 2 beanbags");
  for (const seat of seats) {
    const x = Math.floor((seat.anchorX ?? seat.x) - 0.5);
    const y = Math.floor((seat.anchorZ ?? seat.z) - 0.5);
    const route = findPath(spawn.col, spawn.row, x, y, walkable, (a, b) =>
      clearSegment(a, b, walkable),
    );
    assert.ok(route, `reachable seat ${x},${y}`);
    for (let i = 1; i < route.length; i++)
      assert.ok(clearSegment(route[i - 1], route[i], walkable));
  }
});

test("server and focus zones exclude ambient wandering independently of reusable movement", () => {
  const zones = readAmbientZones(
    buildOfficeEnvironment("tech") as unknown as Record<string, unknown>,
  );
  assert.equal(zones.length, TECH_STARTUP_ZONES.length);
  assert.equal(ambientTileAllowed(zones, 3, 3), false);
  assert.equal(ambientTileAllowed(zones, 9, 3), false);
  assert.equal(ambientTileAllowed(zones, 35, 8), true);
});

test("tech entrance opening and spawn share the exported reference anchors", () => {
  const map = buildOfficeEnvironment("tech");
  const spawn = map.layers
    .flatMap((layer) => layer.objects ?? [])
    .find((object) => object.type === "spawn")!;
  assert.equal(spawn.x / map.tilewidth, TECH_STARTUP_ENTRANCE.spawnCol);
  assert.equal(spawn.y / map.tileheight, TECH_STARTUP_ENTRANCE.spawnRow);
  assert.equal(map.height - 1, TECH_STARTUP_ENTRANCE.row);
  const blocked = new Set(tiledSnapshot(map).blocked);
  for (let x = 0; x < map.width; x++)
    assert.equal(
      blocked.has(`${x},${TECH_STARTUP_ENTRANCE.row}`),
      x < TECH_STARTUP_ENTRANCE.fromCol || x > TECH_STARTUP_ENTRANCE.toCol,
    );
});

import * as T from "three";
import { renderTechStartupObject } from "./tech-startup-assets";
import { renderCreativeStudioObject } from "./creative-studio-renderer";
import { disposeTree } from "./dispose-tree";

test("paired workstation dividers meet at the central seam and rendered chairs center on each worktop", async () => {
  const objects = tiledSnapshot(buildOfficeEnvironment("tech")).objects;
  const desks = objects.filter((object) => object.variant === "tech-workstation");
  assert.equal(desks.length, 16);
  for (const desk of desks) {
    const host = new T.Group();
    assert.equal(renderTechStartupObject(host, desk, objects), true);
    host.updateMatrixWorld(true);
    const divider = host
      .getObjectByName("workstation-rear-divider")!
      .getWorldPosition(new T.Vector3());
    assert.equal(desk.direction, desk.row === 10 ? "up" : "down");
    assert.ok(Math.abs(divider.z - 11) < 0.1, `divider meets the shared seam: ${desk.id}`);
    const chair = objects.find(
      (object) =>
        object.type === "chair" &&
        object.col === desk.col &&
        object.row === (desk.row === 10 ? 9 : 12),
    )!;
    assert.ok(chair);
    const chairHost = new T.Group();
    assert.equal(
      renderCreativeStudioObject(chairHost, chair, objects, { load: async () => new T.Group() }),
      true,
    );
    await chairHost.userData.assetReady;
    assert.equal(
      chairHost.position.x,
      desk.col + 1,
      "chair centers on the two-tile desk, not the tile anchor",
    );
    assert.equal(chairHost.position.z, chair.row + 0.5);
    assert.equal(chair.direction, desk.row === 10 ? "down" : "up");
    disposeTree(host);
    disposeTree(chairHost);
  }
});
