import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSeatAction,
  resolveSeatIntent,
  seatReservationId,
  seatSelectionHighlighted,
} from "./seat-action";

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

test("a selected seat stays highlighted while its movement intent is active", () => {
  assert.equal(seatSelectionHighlighted("144:240", "144:240", 3, true), true);
});

test("a selected seat stops highlighting on arrival or rejected intent", () => {
  assert.equal(seatSelectionHighlighted("144:240", "144:240", 0.2, false), false);
  assert.equal(seatSelectionHighlighted("144:240", null, 3, false), false);
});

test("a newly clicked seat path supersedes the seat the player is leaving", () => {
  assert.equal(resolveSeatIntent({ x: 8, y: 5, seat: true }, "144:240"), "272:176");
  assert.equal(resolveSeatIntent({ x: 8, y: 5, seat: false }, "144:240"), "144:240");
});
