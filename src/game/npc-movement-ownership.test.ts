import test from "node:test";
import assert from "node:assert/strict";
import { NpcMovementOwnership, publishNpcArrival } from "./npc-movement-ownership";
import { TrafficCoordinator } from "./traffic";
import { ambientLeader, AmbientDepartures } from "./npc-ambient";

test("a nonleader call disables the leader's existing ambient route and has one movement publisher", () => {
  const clients = ["a", "b"].map((id) => ({
    id,
    claims: new NpcMovementOwnership(),
    traffic: new TrafficCoordinator(),
    position: { id: "npc", x: 1, y: 1 },
    commands: 0,
  }));
  for (const client of clients) client.claims.claim("npc", "b");
  assert.equal(clients[0].claims.mayRoam("npc", true), false);
  const floor = (x: number, y: number) => x >= 0 && x < 10 && y >= 0 && y < 4;
  for (let frame = 0; frame < 100; frame++)
    for (const client of clients) {
      if (
        !client.claims.mayDrive(
          "npc",
          client.id,
          ambientLeader(
            client.id,
            clients.filter((c) => c !== client).map((c) => c.id),
          ),
        )
      )
        continue;
      const next = client.traffic.step(
        "npc",
        client.position,
        { x: 8, y: 1 },
        0.05,
        frame * 25,
        floor,
        [client.position],
      );
      Object.assign(client.position, next);
      client.commands++;
      // Existing server relay: recipients follow this position instead of running their old route.
      for (const peer of clients) if (peer !== client) Object.assign(peer.position, next);
    }
  assert.equal(clients[0].commands, 0);
  assert.equal(clients[1].commands, 100);
  assert.deepEqual(clients[0].position, clients[1].position);
});

test("call arrival keeps ownership; return releases only after final home position precedes stop", () => {
  const owner = new NpcMovementOwnership(),
    follower = new NpcMovementOwnership();
  for (const client of [owner, follower]) client.claim("npc", "b");
  const home = { x: 80, y: 112 };
  assert.equal(
    follower.finishReturn("npc", home, home),
    false,
    "call arrival at home is not a return",
  );
  for (const client of [owner, follower]) client.startReturn("npc");
  let remote = { x: 50, y: 112 };
  assert.equal(follower.finishReturn("npc", remote, home), false);
  const events: string[] = [];
  publishNpcArrival(
    (event, payload) => {
      events.push(event);
      if (event === "npc:position-update") remote = { x: payload.x!, y: payload.y! };
      else assert.equal(follower.finishReturn("npc", remote, home), true);
    },
    { channelId: "channel", npcId: "npc", ...home, direction: "down" },
  );
  assert.deepEqual(events, ["npc:position-update", "npc:arrived"]);
  assert.equal(owner.finishReturn("npc", home, home), true);
  assert.equal(follower.mayRoam("npc", true), true);
  assert.equal(owner.mayRoam("npc", false), false);
});

test("latest broadcast caller owns movement on both clients; duplicate acknowledgement preserves return phase", () => {
  for (const localId of ["a", "b"]) {
    const claims = new NpcMovementOwnership();
    claims.claim("npc", "b");
    claims.claim("npc", "a");
    assert.equal(claims.mayDrive("npc", localId, localId === "a"), localId === "a");
    claims.startReturn("npc");
    assert.equal(claims.claim("npc", "a"), false);
    assert.equal(claims.finishReturn("npc", { x: 1, y: 1 }, { x: 1, y: 1 }), true);
  }
});

test("owner departure releases only its NPCs, and missing owner snapshots never invent a return driver", () => {
  const claims = new NpcMovementOwnership();
  claims.claim("one", "a");
  claims.claim("two", "b");
  assert.deepEqual(claims.releaseOwner("a"), ["one"]);
  assert.equal(claims.owner("two"), "b");
  assert.equal(claims.mayDrive("one", undefined, true), false);
  assert.equal(claims.startReturn("unknown-late-join-npc"), false);
  claims.startReturn("two");
  assert.equal(claims.finishReturn("two", { x: NaN, y: 0 }, { x: 0, y: 0 }), false);
});

test("server peer IDs select one ambient leader before remote sprites load, with the existing two-slot gate", () => {
  const peers = ["a", "b"];
  const eligible: string[] = [];
  for (const local of peers) {
    const claims = new NpcMovementOwnership();
    const gate = new AmbientDepartures();
    let active = 0;
    for (let i = 0; i < 10; i++)
      if (
        claims.mayRoam(
          `npc-${i}`,
          ambientLeader(
            local,
            peers.filter((id) => id !== local),
          ),
        ) &&
        gate.canDepart(100000, active)
      ) {
        active++;
        eligible.push(`${local}:npc-${i}`);
      }
  }
  assert.equal(eligible.length, 2);
  assert.ok(eligible.every((value) => value.startsWith("a:")));
});
