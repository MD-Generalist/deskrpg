type Point = { x: number; y: number };
type PositionBody = { reset(x: number, y: number): unknown };

/** Commit the checked endpoint; never let a later fixed physics step integrate
 * a velocity calculated for a different rendering delta. Arcade reset also
 * synchronizes prev/prevFrame, so postUpdate cannot apply the movement twice. */
export function commitPlayerStep(body: PositionBody, from: Point, to: Point) {
  body.reset(to.x, to.y);
  return from.x !== to.x || from.y !== to.y;
}
