import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { copyMotionContinuation, playerMotionGoal } from "./runtime-hydration";
import { RemoteNpcPresentation } from "./remote-npc-presentation";
import { adoptNpcMotionHome, untouchedSpawn } from "./motion-snapshot";

const source = readFileSync(new URL("./scenes/GameScene.ts", import.meta.url), "utf8");

test("async actor hydration stops after the Phaser scene shuts down", () => {
  const npcPrefetch = source.slice(
    source.indexOf("this.prefetchNpcPositions().then"),
    source.indexOf(
      "// Listen for spritesheet texture",
      source.indexOf("this.prefetchNpcPositions().then"),
    ),
  );
  const playerTexture = source.slice(
    source.indexOf("  private loadPlayerTexture("),
    source.indexOf("  /** Check if a tile", source.indexOf("  private loadPlayerTexture(")),
  );

  assert.match(npcPrefetch, /if \(!this\.sys\.isActive\(\)\) return;/);
  assert.equal(
    playerTexture.match(/if \(!this\.sys\.isActive\(\)\) return;/g)?.length,
    2,
    "both image completion paths must ignore a disposed scene",
  );
});

function evaluate(code: string, extra: object = {}) {
  const scope = {
    RemoteNpcPresentation,
    TILE_SIZE: 32,
    DIR_DOWN: 0,
    DIR_NAME_MAP: { down: 0, left: 1, up: 2, right: 3 },
    SPRITE_COLS: 9,
    MOVE_SEND_INTERVAL: 0,
    MAP_COLS: 10,
    MAP_ROWS: 10,
    isSeatAnchor: () => false,
    playerMotionGoal,
    adoptNpcMotionHome,
    untouchedSpawn,
    adoptNpcMotionHome,
    ...extra,
  };
  return runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    scope,
  );
}
const spawnStart =
  source.indexOf('listen("player:spawn", (position: PlayerSpawnState) => {') +
  'listen("player:spawn", (position: PlayerSpawnState) => {'.length;
const spawnBody = source
  .slice(spawnStart, source.indexOf('    listen("players:state",', spawnStart))
  .replace(/\s*\}\);\s*$/, "");
const applySpawn = evaluate(`(function(position) { ${spawnBody} })`);
const resumeSource = source.slice(
  source.indexOf("  private canMovePlayer("),
  source.indexOf("  private npcContinuation("),
);
const ResumeController = evaluate(`(class { ${resumeSource} })`);
function scene() {
  const player = {
    x: 48,
    y: 48,
    frame: 0,
    anims: { stop() {} },
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
    setFrame(frame: number) {
      this.frame = frame;
    },
  };
  return Object.assign(new ResumeController(), {
    socket: { id: "self", connected: true },
    peerSnapshotReady: true,
    motionSnapshot: { current: { seats: [] } },
    motionGeneration: 1,
    reserveSeat: (_id: string, _x: number, _y: number, done: (ok: boolean) => void) => done(true),
    releaseSeat() {},
    clearPathLine() {},
    player,
    spawnRequest: { x: 48, y: 48 },
    spawnInputStarted: false,
    currentDirection: 0,
    playerActuallyWalking: false,
    playerNameLabel: { setPosition() {} },
    traffic: { clear() {} },
    currentPath: null as unknown,
    playerSeatGoal: null,
    playerSpawnReady: false,
    lastSentMotion: "",
    findPlayerPath: (_sx: number, _sy: number, ex: number, ey: number) => [
      { x: 3, y: 4 },
      { x: ex, y: ey },
    ],
    drawPathLine() {},
  });
}
test("real spawn handler restores facing, seat intent and click route instead of configured spawn", () => {
  const runtime = scene();
  applySpawn.call(runtime, {
    x: 112,
    y: 144,
    direction: "left",
    animation: "walk",
    restored: true,
    motion: { targetX: 240, targetY: 272, seatId: "240:272" },
  });
  assert.deepEqual([runtime.player.x, runtime.player.y, runtime.currentDirection], [112, 144, 1]);
  assert.equal(runtime.playerSeatGoal, "240:272");
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.currentPath)), [
    { x: 3, y: 4 },
    { x: 7, y: 8 },
  ]);
  assert.equal(runtime.playerSpawnReady, true);
});
test("real spawn handler does not undo newer input, and keyboard walk does not resume itself", () => {
  const runtime = scene();
  runtime.spawnInputStarted = true;
  runtime.player.x = 80;
  applySpawn.call(runtime, { x: 112, y: 144, direction: "left", restored: true });
  assert.equal(runtime.player.x, 80);
  const fresh = scene();
  applySpawn.call(fresh, { x: 112, y: 144, direction: "up", animation: "walk", restored: true });
  assert.equal(fresh.currentPath, null);
  assert.equal(fresh.playerActuallyWalking, false);
  assert.equal(fresh.currentDirection, 2);
});
const sendSource = source.slice(
  source.indexOf("  private sendPosition("),
  source.indexOf("  // Speech bubbles", source.indexOf("  private sendPosition(")),
);
const Controller = evaluate(`(class { ${sendSource} })`);
test("real movement sender waits for both snapshots and transmits changed goals at unchanged coordinates", () => {
  const calls: unknown[] = [];
  const runtime = Object.assign(new Controller(), {
    socket: { connected: true, emit: (...args: unknown[]) => calls.push(args) },
    playerSpawnReady: false,
    peerSnapshotReady: true,
    lastMoveSent: 0,
    lastSentX: 112,
    lastSentY: 144,
    lastSentDir: "left",
    lastSentAnim: "idle",
    lastSentMotion: "null",
    currentPath: [{ x: 7, y: 8 }],
    playerSeatGoal: null,
  });
  runtime.sendPosition(112, 144, "left", "idle");
  assert.equal(calls.length, 0);
  runtime.playerSpawnReady = true;
  runtime.peerSnapshotReady = false;
  runtime.sendPosition(112, 144, "left", "idle");
  assert.equal(calls.length, 0);
  runtime.peerSnapshotReady = true;
  runtime.sendPosition(112, 144, "left", "idle");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [
      "player:move",
      {
        x: 112,
        y: 144,
        direction: "left",
        animation: "idle",
        motion: { targetX: 240, targetY: 272 },
      },
    ],
  ]);
});
test("ambient continuation preserves rest clock and deep copies paths and seat targets", () => {
  const original = {
    ambientSchedule: {
      phase: "roam" as const,
      elapsed: 15000,
      duration: 30000,
      pause: 2000,
      seatRest: 7000,
      seatTarget: { x: 4, y: 5 },
    },
    ambientSeat: { x: 2, y: 3 },
    ambientTimer: 1500,
    path: [{ x: 5, y: 6 }],
  };
  const copy = copyMotionContinuation(original);
  assert.equal(copy.ambientSchedule.seatRest, 7000);
  assert.equal(copy.ambientSchedule.elapsed, 15000);
  copy.path![0].x = 99;
  copy.ambientSchedule.seatTarget!.x = 99;
  assert.equal(original.path[0].x, 5);
  assert.equal(original.ambientSchedule.seatTarget.x, 4);
});
const applyNpcSource = source.slice(
  source.indexOf("  private applyMotionNpc("),
  source.indexOf("  private restoreMotionNpc("),
);
const NpcController = evaluate(`(class { ${applyNpcSource} })`, {
  copyMotionContinuation,
  createAmbientSchedule: () => {
    throw new Error("must not reset restored schedule");
  },
  AmbientExitPolicy: class {},
  EventBus: { emit() {} },
});
test("real NPC hydration resumes ambient destination without resetting its break clock", () => {
  const runtime = Object.assign(new NpcController(), {
    socket: { id: "new" },
    motionSnapshot: { current: { ambientLeaderId: "new", seats: [] } },
    npcOwnership: { owner: () => undefined, clear() {} },
    traffic: { clear() {} },
    time: { now: 0 },
    ambientZones: [],
    pendingNpcCalls: new Map(),
  });
  const npc = {
    id: "npc",
    homeCol: 2,
    homeRow: 3,
    moveState: "idle",
    pixelX: 48,
    pixelY: 48,
    ambientSchedule: {},
    ambientSeat: null,
    ambientTimer: 0,
    sprite: { setPosition() {} },
    nameLabel: { setPosition() {} },
    cancelMovement() {},
    startStroll(path: unknown) {
      this.path = path;
    },
    path: null as unknown,
  };
  runtime.applyMotionNpc(
    npc,
    {
      npcId: "npc",
      x: 144,
      y: 176,
      direction: "up",
      ownerSocketId: null,
      phase: "ambient",
      moving: true,
      continuation: {
        ambientSchedule: { phase: "roam", elapsed: 9000, duration: 30000, pause: 2000 },
        ambientSeat: { x: 2, y: 3 },
        ambientTimer: 800,
        path: [{ x: 6, y: 7 }],
      },
    },
    true,
  );
  assert.deepEqual([npc.pixelX, npc.pixelY, npc.ambientTimer], [144, 176, 800]);
  assert.equal((npc.ambientSchedule as { elapsed: number }).elapsed, 9000);
  assert.deepEqual(JSON.parse(JSON.stringify(npc.path)), [{ x: 6, y: 7 }]);
});
test("remembered seat waits for a fresh claim and rejected claims never resume movement", () => {
  const runtime = scene();
  let answer: ((ok: boolean) => void) | undefined;
  runtime.reserveSeat = (_id: string, _x: number, _y: number, done: (ok: boolean) => void) => {
    answer = done;
  };
  applySpawn.call(runtime, {
    x: 112,
    y: 144,
    direction: "left",
    restored: true,
    motion: { targetX: 240, targetY: 272, seatId: "240:272" },
  });
  assert.equal(runtime.currentPath, null, "cache entry is not a seat lease");
  assert.equal(runtime.playerSeatGoal, null);
  assert.ok(answer);
  answer(false);
  assert.equal(runtime.currentPath, null);
  assert.equal(runtime.playerSeatGoal, null);
});
test("goal waits for all authoritative snapshots before a seat can be reclaimed", () => {
  const runtime = scene();
  runtime.peerSnapshotReady = false;
  applySpawn.call(runtime, {
    x: 112,
    y: 144,
    restored: true,
    motion: { targetX: 240, targetY: 272, seatId: "240:272" },
  });
  assert.equal(runtime.currentPath, null);
  runtime.peerSnapshotReady = true;
  runtime.motionSnapshot.current = null;
  runtime.resumePlayerGoal();
  assert.equal(runtime.currentPath, null);
  runtime.motionSnapshot.current = { seats: [] };
  runtime.resumePlayerGoal();
  assert.ok(runtime.currentPath);
});
const updateStart = source.indexOf("  update(): void {") + "  update(): void {".length;
const updatePrefix = source.slice(
  updateStart,
  source.indexOf("    // Update NPC movement", updateStart),
);
const UpdateController = evaluate(`(class { update() { ${updatePrefix} } })`);
test("real update prefix freezes local input before hydration while remote players keep updating", () => {
  const runtime = scene();
  runtime.playerSpawnReady = false;
  runtime.spawnInputStarted = false;
  let peerUpdates = 0;
  let stopped = 0;
  Object.assign(runtime, {
    updateRemoteNpcPresentation() {},
    publishReturnDiagnostics() {},
    remotePlayers: new Map([["peer", { lerpUpdate: () => peerUpdates++ }]]),
    cursors: { right: { isDown: true } },
  });
  runtime.player.body = { setVelocity: () => stopped++ };
  UpdateController.prototype.update.call(runtime);
  assert.equal(peerUpdates, 1);
  assert.equal(stopped, 1);
  assert.equal(runtime.spawnInputStarted, false);
  assert.equal(runtime.player.x, 48);
  applySpawn.call(runtime, { x: 112, y: 144, direction: "up", restored: true });
  assert.equal(runtime.player.x, 112, "early keyboard state cannot defeat authoritative spawn");
});

test("failed reclaim while already on the old chair recovers to free floor", () => {
  const runtime = scene();
  runtime.reserveSeat = (_id: string, _x: number, _y: number, done: (ok: boolean) => void) =>
    done(false);
  runtime.isWalkable = (x: number, y: number) => x === 6 && y === 7;
  runtime.isTileOccupied = () => false;
  runtime.mapObjects = [];
  applySpawn.call(runtime, {
    x: 240,
    y: 272,
    restored: true,
    motion: { targetX: 240, targetY: 272, seatId: "240:272" },
  });
  assert.deepEqual([runtime.player.x, runtime.player.y], [208, 240]);
  assert.equal(runtime.playerSeatGoal, null);
  assert.equal(runtime.currentPath, null);
});
test("pending seat ACK keeps the resume target in outgoing movement snapshots", () => {
  const calls: unknown[] = [];
  const goal = { targetX: 240, targetY: 272, seatId: "240:272" };
  const runtime = Object.assign(new Controller(), {
    socket: { connected: true, emit: (...args: unknown[]) => calls.push(args) },
    playerSpawnReady: true,
    peerSnapshotReady: true,
    lastMoveSent: 0,
    lastSentMotion: "",
    currentPath: null,
    playerSeatGoal: null,
    resumingPlayerGoal: goal,
    spawnInputStarted: false,
  });
  runtime.sendPosition(112, 144, "left", "idle");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["player:move", { x: 112, y: 144, direction: "left", animation: "idle", motion: goal }],
  ]);
});
test("ordinary remote motion snapshots do not cancel a stable remote actor on every packet", () => {
  let cancelled = 0;
  const runtime = Object.assign(new NpcController(), {
    socket: { id: "observer" },
    motionSnapshot: { current: { ambientLeaderId: "driver", seats: [] } },
    npcOwnership: { owner: () => undefined, clear() {} },
    traffic: { clear() {} },
    time: { now: 100 },
    ambientZones: [],
    pendingNpcCalls: new Map(),
  });
  const npc = {
    id: "npc",
    homeCol: 2,
    homeRow: 3,
    moveState: "idle",
    pixelX: 48,
    pixelY: 48,
    motionLocallyDriven: false,
    ambientSchedule: {},
    ambientSeat: null,
    ambientTimer: 0,
    sprite: { setPosition() {} },
    nameLabel: { setPosition() {} },
    cancelMovement() {
      cancelled++;
    },
  };
  runtime.applyMotionNpc(
    npc,
    {
      npcId: "npc",
      x: 80,
      y: 48,
      direction: "right",
      ownerSocketId: null,
      phase: "ambient",
      moving: true,
    },
    false,
  );
  assert.equal(
    cancelled,
    0,
    "stable remote target updates must preserve the presentation timeline",
  );
  assert.deepEqual([npc.pixelX, npc.pixelY], [80, 48], "collision coordinates update immediately");
});
test("stable local leader ignores echoed coordinates and preserves its active path", () => {
  const runtime = Object.assign(new NpcController(), {
    socket: { id: "driver" },
    motionSnapshot: { current: { ambientLeaderId: "driver", seats: [] } },
    npcOwnership: { owner: () => undefined, clear() {} },
    traffic: { clear() {} },
    time: { now: 100 },
    ambientZones: [],
    pendingNpcCalls: new Map(),
  });
  const path = [{ x: 6, y: 7 }];
  const npc = {
    id: "npc",
    homeCol: 2,
    homeRow: 3,
    moveState: "strolling",
    pixelX: 90,
    pixelY: 48,
    motionLocallyDriven: true,
    currentPath: path,
    ambientSchedule: {},
    ambientSeat: null,
    sprite: {
      setPosition() {
        throw new Error("must not snap driver echo");
      },
    },
    nameLabel: { setPosition() {} },
    cancelMovement() {
      throw new Error("must not cancel driver path");
    },
  };
  runtime.applyMotionNpc(
    npc,
    {
      npcId: "npc",
      x: 80,
      y: 48,
      direction: "right",
      ownerSocketId: null,
      phase: "ambient",
      moving: true,
    },
    false,
  );
  assert.equal(npc.pixelX, 90);
  assert.equal(npc.currentPath, path);
});
const legacyStart = source.indexOf('      "npc:position-sync",');
const legacyBodyStart = source.indexOf(" => {", legacyStart) + " => {".length;
const legacyBodyEnd = source.indexOf("      },\n    );", legacyBodyStart);
const applyLegacy = evaluate(
  `(function(data) { ${source.slice(legacyBodyStart, legacyBodyEnd)} })`,
);
test("legacy duplicate cannot snap a snapshot-driven NPC or clear its walking flag", () => {
  const npc = {
    id: "npc",
    pixelX: 80,
    pixelY: 48,
    remoteWalkingUntil: 600,
    sprite: {
      setPosition() {
        throw new Error("duplicate legacy update");
      },
    },
  };
  applyLegacy.call(
    { npcSprites: [npc], motionSnapshot: { current: { npcs: [{ npcId: "npc" }] } } },
    { npcId: "npc", x: 80, y: 48, direction: "right" },
  );
  assert.equal(npc.remoteWalkingUntil, 600);
});
