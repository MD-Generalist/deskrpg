import { commonAreaSeats } from "./seating";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSeat, seatAt, sofaSeats, isSeatAnchor } from "./seating";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
const table: MapObject = { id: "table", type: "meeting_table", col: 5, row: 5 };
test("chairs on all four sides face the table", () => {
  for (const [col, row, direction] of [
    [4, 5, "right"],
    [7, 5, "left"],
    [5, 4, "down"],
    [6, 7, "up"],
  ] as const) {
    assert.equal(
      resolveSeat({ id: "chair", type: "chair", col, row }, [table]).direction,
      direction,
    );
  }
});
test("explicit chair orientation wins and distant furniture does not attract chairs", () => {
  const chair: MapObject = { id: "chair", type: "chair", col: 4, row: 5, direction: "up" };
  assert.equal(resolveSeat(chair, [table]).direction, "up");
  assert.equal(resolveSeat({ ...chair, direction: undefined, col: 20 }, [table]).direction, "down");
});
test("sit only after arriving at chair center; walking immediately leaves the seat", () => {
  const seats = [{ x: 4.5, z: 5.5, direction: "right" as const }];
  assert.equal(seatAt(seats, 4.5, 5.5, false), seats[0]);
  assert.equal(seatAt(seats, 4.5, 5.5, true), undefined);
  assert.equal(seatAt(seats, 4.9, 5.5, false), undefined);
});

test("single chairs align with even-width table center without changing their tile", () => {
  const chair: MapObject = { id: "c", type: "chair", col: 6, row: 7 };
  const seat = resolveSeat(chair, [table, chair]);
  assert.equal(seat.x, 6);
  assert.equal(seat.anchorX, 6.5);
  assert.equal(seatAt([seat], 6.5, 7.5, false), seat);
  assert.equal(seatAt([seat], 6, 7.5, false), undefined);
});
test("multiple chairs along one edge stay distinct and symmetric", () => {
  const a: MapObject = { id: "a", type: "chair", col: 5, row: 7 };
  const b: MapObject = { id: "b", type: "chair", col: 6, row: 7 };
  const objects = [table, a, b];
  const left = resolveSeat(a, objects),
    right = resolveSeat(b, objects);
  assert.ok(left.x < right.x);
  assert.equal((left.x + right.x) / 2, 6);
  assert.equal(left.z, right.z);
});

test("six conference chairs face a continuous table and remain on their navigation anchors", () => {
  const table: MapObject = { id: "conference", type: "conference_table", col: 13, row: 4 };
  const chairs: MapObject[] = [
    [13, 3],
    [16, 3],
    [13, 6],
    [16, 6],
    [12, 4],
    [17, 4],
  ].map(([col, row], i) => ({ id: `seat-${i}`, type: "chair", col, row }));
  const seats = chairs.map((chair) => resolveSeat(chair, [table, ...chairs]));
  assert.deepEqual(
    seats.map((seat) => seat.direction),
    ["down", "down", "up", "up", "right", "left"],
  );
  assert.equal(new Set(seats.map((seat) => `${seat.x},${seat.z}`)).size, 6);
  for (let i = 0; i < chairs.length; i++) {
    assert.equal(seats[i].anchorX, chairs[i].col + 0.5);
    assert.equal(seats[i].anchorZ, chairs[i].row + 0.5);
  }
});

test("sofas expose one anchor per cushion outside their solid body", () => {
  for (const [type, count] of [
    ["office_sofa", 2],
    ["office_armchair", 1],
  ] as const) {
    const object: MapObject = { id: type, type, col: 3, row: 5 };
    const seats = sofaSeats(object);
    assert.equal(seats.length, count);
    assert.equal(new Set(seats.map((s) => `${s.anchorX},${s.anchorZ}`)).size, count);
    for (const seat of seats) {
      assert.equal(seat.anchorZ, 6.5);
      assert.equal(isSeatAnchor([object], seat.anchorX! - 0.5, 6), true);
      assert.equal(seatAt(seats, seat.anchorX!, seat.anchorZ!, false), seat);
      assert.equal(seatAt(seats, seat.anchorX!, seat.anchorZ!, true), undefined);
      assert.ok(seat.z < 6);
    }
  }
});

test("common destinations include meeting chairs and sofa cushions, not desk chairs", () => {
  const objects: MapObject[] = [
    { id: "desk", type: "desk", col: 1, row: 1 },
    { id: "work", type: "chair", col: 1, row: 2 },
    { id: "table", type: "meeting_table", col: 8, row: 4 },
    { id: "meeting", type: "chair", col: 7, row: 4 },
    { id: "lounge", type: "office_sofa", col: 15, row: 8 },
    { id: "single", type: "office_armchair", col: 19, row: 8 },
  ];
  const seats = commonAreaSeats(objects);
  assert.equal(seats.length, 4);
  assert.ok(seats.every((s) => s.anchorX !== 1.5));
  assert.ok(seats.some((s) => s.anchorX === 7.5));
});

test("sofa calf clearance follows all rotations without moving saved anchors", () => {
  for (const type of ["office_sofa", "office_armchair"] as const) {
    for (const direction of ["down", "right", "up", "left"] as const) {
      const object: MapObject = { id: type, type, col: 10, row: 10, direction };
      const angle = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[direction];
      const size = getObjectDimensions(type, direction);
      const cx = object.col + size.width / 2,
        cz = object.row + size.height / 2;
      for (const seat of sofaSeats(object)) {
        const forward = (seat.x - cx) * Math.sin(angle) + (seat.z - cz) * Math.cos(angle);
        // Shortest supplied female ankle is +0.2246; allow 9 cm behind it
        // for calf/shoe volume. Sofa body front is +0.41.
        assert.ok(forward + 0.2246 - 0.09 > 0.41);
        const anchorForward =
          (seat.anchorX! - cx) * Math.sin(angle) + (seat.anchorZ! - cz) * Math.cos(angle);
        assert.ok(Math.abs(anchorForward - 1) < 1e-9);
        assert.equal(seat.elevation, 0.055, "do not lift feet to hide clipping");
      }
    }
  }
});

test("studio table chairs preserve tile anchors and face every rotated table edge", () => {
  for (const type of ["studio_round_table", "studio_worktable"]) {
    for (const direction of ["down", "right", "up", "left"] as const) {
      const table: MapObject = { id: "table", type, col: 8, row: 8, direction };
      const { width, height } = getObjectDimensions(type, direction);
      for (const [col, row, facing] of [
        [7, 8, "right"],
        [8 + width, 8, "left"],
        [8, 7, "down"],
        [8, 8 + height, "up"],
      ] as const) {
        const chair: MapObject = { id: "chair", type: "chair", col, row, variant: "teal" };
        const seat = resolveSeat(chair, [table, chair]);
        assert.equal(seat.direction, facing);
        assert.equal(seat.anchorX, col + 0.5);
        assert.equal(seat.anchorZ, row + 0.5);
        assert.equal(commonAreaSeats([table, chair]).length, 1);
      }
    }
  }
});
