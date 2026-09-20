import assert from "node:assert/strict";
import test from "node:test";

import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "@/game/three/office-environments";
import { deriveChannelMotionLayout } from "./channel-motion-layout";
import { planPlacements, seatNumberAt, seatingMapFor } from "./seat-assignment";

const executive = () => seatingMapFor({ mapData: buildOfficeEnvironment("executive") })!;

test("번호는 1부터 연속이고 두 번 계산해도 같다", () => {
  for (const env of OFFICE_ENVIRONMENTS) {
    const a = seatingMapFor({ mapData: buildOfficeEnvironment(env.id) })!;
    const b = seatingMapFor({ mapData: buildOfficeEnvironment(env.id) })!;
    assert.deepEqual(a, b);
    assert.deepEqual(
      a.seats.map((s) => s.number),
      a.seats.map((_, i) => i + 1),
    );
  }
});

test("투영할 수 없는 맵이면 null", () => {
  assert.equal(seatingMapFor({ mapData: null }), null);
  assert.equal(seatingMapFor({ mapData: { hello: 1 } }), null);
});

test("seatNumberAt: 데스크 좌석이면 번호, 아니면 null", () => {
  const { seats, standing } = executive();
  assert.equal(seatNumberAt(seats, seats[2].col, seats[2].row), 3);
  assert.equal(seatNumberAt(seats, standing[0].col, standing[0].row), null);
  assert.equal(seatNumberAt(seats, null, null), null);
});

test("서는 칸은 걸을 수 있고, 좌석·입구가 아니며, 8이웃이 모두 열려 있다", () => {
  const mapData = buildOfficeEnvironment("executive");
  const layout = deriveChannelMotionLayout({ mapData }, [])!;
  const { standing } = executive();
  assert.ok(standing.length > 0);
  const seatTiles = new Set(
    layout.seats.map((s) => `${Math.floor(s.x / 32)},${Math.floor(s.y / 32)}`),
  );
  for (const t of standing) {
    assert.ok(!seatTiles.has(`${t.col},${t.row}`));
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) assert.ok(layout.isWalkable(t.col + dx, t.row + dy));
  }
});

test("빈 좌석을 번호 순으로 채우고, 만석이면 서는 칸에 세운다", () => {
  const map = executive(); // 데스크 3석(대표석은 빠진다)
  const npcs = ["f", "a", "c", "b", "e", "d"].map((id) => ({ id }));
  const plan = planPlacements(npcs, map, []);
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.slice(0, 3).map((p) => [p.npcId, p.seated, seatNumberAt(map.seats, p.col, p.row)]),
    [
      ["a", true, 1],
      ["b", true, 2],
      ["c", true, 3],
    ],
  );
  assert.ok(
    plan.slice(3).every((p) => !p.seated && seatNumberAt(map.seats, p.col, p.row) === null),
  );
  assert.ok(
    plan.every((p) => map.reserved.every((tile) => tile.col !== p.col || tile.row !== p.row)),
    "아무도 대표석에 두지 않는다",
  );
  assert.equal(new Set(plan.map((p) => `${p.col},${p.row}`)).size, 6, "같은 칸에 둘을 두지 않는다");
  assert.deepEqual(planPlacements(npcs, map, []), plan, "결정적이다");
});

test("이미 찬 좌석(휴면 포함)은 건너뛴다", () => {
  const map = executive();
  const occupied = [{ positionX: map.seats[0].col, positionY: map.seats[0].row }];
  const [first] = planPlacements([{ id: "x" }], map, occupied);
  assert.equal(seatNumberAt(map.seats, first.col, first.row), 2);
});

test("좌석도 서는 칸도 없으면 계획에서 빠진다", () => {
  assert.deepEqual(
    planPlacements([{ id: "x" }], { seats: [], standing: [], reserved: [] }, []),
    [],
  );
});

test("대표석은 직원 지정석이 아니다 — executive_desk 뒤편 의자는 좌석 목록에서 빠지고 reserved 로 나온다", () => {
  // 대표 책상이 있는 맵마다, 책상 바로 뒤(책상이 바라보는 쪽을 같이 보는) 의자가 대표석이다.
  const expected = { executive: { col: 4, row: 5 }, agency: { col: 3, row: 12 } } as const;
  for (const [id, boss] of Object.entries(expected)) {
    const map = seatingMapFor({ mapData: buildOfficeEnvironment(id as keyof typeof expected) })!;
    assert.deepEqual(map.reserved, [boss], `${id}: 대표석을 reserved 로 알린다`);
    assert.equal(seatNumberAt(map.seats, boss.col, boss.row), null, `${id}: 대표석에 번호가 없다`);
    assert.ok(
      map.standing.every((tile) => tile.col !== boss.col || tile.row !== boss.row),
      `${id}: 대표석은 서는 칸도 아니다`,
    );
  }
  // 손님 의자(책상 앞)는 그대로 좌석이다 — 대표석만 뺀다.
  const executiveMap = seatingMapFor({ mapData: buildOfficeEnvironment("executive") })!;
  assert.ok(seatNumberAt(executiveMap.seats, 3, 8) !== null);
  assert.ok(seatNumberAt(executiveMap.seats, 6, 8) !== null);
});

test("대표 책상이 없는 맵은 reserved 가 비고 좌석 수가 그대로다", () => {
  for (const [id, count] of [
    ["trading", 28],
    ["tech", 16],
    ["publishing", 13],
  ] as const) {
    const map = seatingMapFor({ mapData: buildOfficeEnvironment(id) })!;
    assert.deepEqual(map.reserved, []);
    assert.equal(map.seats.length, count);
  }
});
