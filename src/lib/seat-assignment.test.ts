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
  const map = executive(); // 데스크 4석
  const npcs = ["f", "a", "c", "b", "e", "d"].map((id) => ({ id }));
  const plan = planPlacements(npcs, map, []);
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.slice(0, 4).map((p) => [p.npcId, p.seated, seatNumberAt(map.seats, p.col, p.row)]),
    [
      ["a", true, 1],
      ["b", true, 2],
      ["c", true, 3],
      ["d", true, 4],
    ],
  );
  assert.ok(plan.slice(4).every((p) => !p.seated && seatNumberAt(map.seats, p.col, p.row) === null));
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
  assert.deepEqual(planPlacements([{ id: "x" }], { seats: [], standing: [] }, []), []);
});
