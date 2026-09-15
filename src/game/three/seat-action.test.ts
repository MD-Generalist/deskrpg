import test from "node:test";
import assert from "node:assert/strict";
import { resolveSeatAction, seatReservationId } from "./seat-action";

const seats = [
  { x: 4, z: 3, anchorX: 4.5, anchorZ: 4.5, direction: "down" },
  { x: 6, z: 3, anchorX: 6.5, anchorZ: 4.5, direction: "down" },
];

test("seat hover resolves the nearest available cushion", () => {
  const action = resolveSeatAction(seats, { x: 5.8, z: 3 }, (seat) => seat.x === 6);

  assert.deepEqual(action, {
    x: 6.5,
    z: 4.5,
    seatX: 6,
    seatZ: 3,
  });
});

test("occupied seats do not expose a sit action", () => {
  assert.equal(
    resolveSeatAction(seats, { x: 4, z: 3 }, () => false),
    null,
  );
});

test("seat availability is checked at the navigation anchor", () => {
  const checked: Array<[number, number]> = [];
  resolveSeatAction(seats, { x: 4, z: 3 }, (seat) => {
    checked.push([seat.anchorX ?? seat.x, seat.anchorZ ?? seat.z]);
    return true;
  });

  assert.deepEqual(checked, [
    [4.5, 4.5],
    [6.5, 4.5],
  ]);
});

test("world anchors match the server's pixel reservation IDs", () => {
  assert.equal(seatReservationId(4.5, 7.5), "144:240");
});
