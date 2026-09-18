import assert from "node:assert/strict";
import test from "node:test";

import { buildOfficeEnvironment } from "@/game/three/office-environments";
import {
  setupThrowawaySqlite,
  seedChannelWithProfiles,
  seedGateway,
  seedChannel,
  seedHermesProfile,
  seedNpc,
  seedUser,
} from "@/test-setup/npc-seed";

setupThrowawaySqlite("npc-seating-test");
const executiveMap = () => buildOfficeEnvironment("executive"); // 데스크 4석

async function positions(channelId: string) {
  const { selectChannelNpcs } = await import("./npc-projection");
  return selectChannelNpcs(channelId, { roster: true });
}

test("자리 없는 직원을 번호 순으로 앉히고, 만석이면 세운다", async () => {
  const { placeUnplacedNpcs, channelSeats } = await import("./npc-seating");
  const { seatNumberAt } = await import("./seat-assignment");
  const { channelId } = await seedChannelWithProfiles({ unplaced: 6, mapData: executiveMap() });

  assert.deepEqual(await placeUnplacedNpcs(channelId), { seated: 4, standing: 2, failed: 0 });
  const seats = (await channelSeats(channelId))!;
  const rows = await positions(channelId);
  assert.ok(rows.every((r) => Number.isInteger(r.positionX) && Number.isInteger(r.positionY)));
  const numbers = rows.map((r) => seatNumberAt(seats, r.positionX, r.positionY));
  assert.deepEqual(numbers.filter((n) => n !== null).sort(), [1, 2, 3, 4]);
  assert.equal(numbers.filter((n) => n === null).length, 2);

  assert.deepEqual(
    await placeUnplacedNpcs(channelId),
    { seated: 0, standing: 0, failed: 0 },
    "멱등",
  );
});

test("이미 자리 있는 직원과 휴면 직원은 건드리지 않는다", async () => {
  const { placeUnplacedNpcs } = await import("./npc-seating");
  const { channelId } = await seedChannelWithProfiles({
    placedActive: 1,
    dormant: 1,
    unplaced: 1,
    mapData: executiveMap(),
  });
  const before = await positions(channelId);
  await placeUnplacedNpcs(channelId);
  const after = await positions(channelId);
  for (const b of before.filter((r) => r.positionX !== null)) {
    const a = after.find((r) => r.id === b.id)!;
    assert.deepEqual([a.positionX, a.positionY], [b.positionX, b.positionY]);
  }
});

test("맵을 읽을 수 없는 채널은 실패로 세고 던지지 않는다", async () => {
  const { placeUnplacedNpcs } = await import("./npc-seating");
  const { channelId } = await seedChannelWithProfiles({ unplaced: 2 });
  assert.deepEqual(await placeUnplacedNpcs(channelId), { seated: 0, standing: 0, failed: 2 });
});

test("존재하지 않는 채널이어도 던지지 않고 failed 0 을 돌려준다", async () => {
  const { placeUnplacedNpcs } = await import("./npc-seating");
  await assert.doesNotReject(async () => {
    const result = await placeUnplacedNpcs("00000000-0000-0000-0000-000000000000");
    assert.deepEqual(result, { seated: 0, standing: 0, failed: 0 });
  });
});

test("positionX 만 있고 positionY 가 없는 직원은 미배치로 보고 두 좌표 모두 채워 한 번만 센다", async () => {
  const { placeUnplacedNpcs } = await import("./npc-seating");
  const user = await seedUser("half-placed-owner");
  const gateway = await seedGateway(user.id);
  const channel = await seedChannel(user.id, undefined, executiveMap());
  const profile = await seedHermesProfile(gateway.id);
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: profile.id,
    positionX: 3,
    positionY: null,
    active: true,
  });

  const result = await placeUnplacedNpcs(channel.id);
  assert.deepEqual(result, { seated: 1, standing: 0, failed: 0 });

  const [row] = await positions(channel.id);
  assert.equal(row.id, npc.id);
  assert.ok(Number.isInteger(row.positionX) && Number.isInteger(row.positionY));
});

test("failed > 0 이면 console.warn 으로 남긴다", async () => {
  const { placeUnplacedNpcs } = await import("./npc-seating");
  const { channelId } = await seedChannelWithProfiles({ unplaced: 2 }); // 맵 없음 → 전원 실패
  const original = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => calls.push(args);
  try {
    await placeUnplacedNpcs(channelId);
  } finally {
    console.warn = original;
  }
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "[seating] active NPCs left without a spot" &&
        (args[1] as { failed?: number })?.failed === 2,
    ),
  );
});

test("placeAllUnplacedNpcs 는 미배치 직원이 있는 채널을 모두 처리한다", async () => {
  const { placeAllUnplacedNpcs } = await import("./npc-seating");
  const a = await seedChannelWithProfiles({ unplaced: 1, mapData: executiveMap() });
  const b = await seedChannelWithProfiles({ unplaced: 1, mapData: executiveMap() });
  const result = await placeAllUnplacedNpcs();
  assert.ok(result.channels >= 2 && result.seated >= 2);
  for (const c of [a, b])
    assert.ok((await positions(c.channelId)).every((r) => r.positionX !== null));
});
