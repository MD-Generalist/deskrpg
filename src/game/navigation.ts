export type NavigationPoint = { x: number; y: number };
export type Walkable = (x: number, y: number) => boolean;
export const ACTOR_RADIUS = 0.22;
export const MAX_WALL_RECOVERY = 0.025;
/** Recover only a shallow existing overlap, strictly toward its nearest face. */
export function clearMovementSegment(a: NavigationPoint, b: NavigationPoint, walkable: Walkable) {
  if (clearSegment(a, b, walkable)) return true;
  const escaping = new Set<string>();
  for (
    let x = Math.floor(a.x + 0.5 - ACTOR_RADIUS);
    x <= Math.floor(a.x + 0.5 + ACTOR_RADIUS);
    x++
  ) {
    for (
      let y = Math.floor(a.y + 0.5 - ACTOR_RADIUS);
      y <= Math.floor(a.y + 0.5 + ACTOR_RADIUS);
      y++
    ) {
      if (walkable(x, y)) continue;
      const faces = [
        { depth: a.x - (x - 0.5 - ACTOR_RADIUS), outward: a.x - b.x },
        { depth: x + 0.5 + ACTOR_RADIUS - a.x, outward: b.x - a.x },
        { depth: a.y - (y - 0.5 - ACTOR_RADIUS), outward: a.y - b.y },
        { depth: y + 0.5 + ACTOR_RADIUS - a.y, outward: b.y - a.y },
      ];
      const depth = Math.min(...faces.map((face) => face.depth));
      if (depth < 0 || depth > MAX_WALL_RECOVERY) continue;
      if (!faces.some((face) => face.depth <= depth + 1e-9 && face.outward > 0)) return false;
      escaping.add(`${x},${y}`);
    }
  }
  // The exemption is local to this one outward segment. Every other wall is
  // still checked, and a later segment cannot use it to re-enter the wall.
  return (
    escaping.size > 0 && clearSegment(a, b, (x, y) => walkable(x, y) || escaping.has(`${x},${y}`))
  );
}
/** Segment versus expanded tile AABBs: conservative body clearance, including corners. */
export function clearSegment(
  a: NavigationPoint,
  b: NavigationPoint,
  walkable: Walkable,
  radius = ACTOR_RADIUS,
) {
  for (
    let y = Math.floor(Math.min(a.y, b.y) + 0.5 - radius);
    y <= Math.floor(Math.max(a.y, b.y) + 0.5 + radius);
    y++
  ) {
    for (
      let x = Math.floor(Math.min(a.x, b.x) + 0.5 - radius);
      x <= Math.floor(Math.max(a.x, b.x) + 0.5 + radius);
      x++
    ) {
      if (walkable(x, y)) continue;
      let enter = 0,
        exit = 1;
      for (const [origin, delta, min, max] of [
        [a.x, b.x - a.x, x - 0.5 - radius, x + 0.5 + radius],
        [a.y, b.y - a.y, y - 0.5 - radius, y + 0.5 + radius],
      ]) {
        if (Math.abs(delta) < 1e-9) {
          if (origin < min || origin > max) {
            enter = 2;
            break;
          }
        } else {
          const t1 = (min - origin) / delta,
            t2 = (max - origin) / delta;
          enter = Math.max(enter, Math.min(t1, t2));
          exit = Math.min(exit, Math.max(t1, t2));
        }
      }
      if (enter <= exit) return false;
    }
  }
  return true;
}
export function findPath(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  isWalkable: Walkable,
  segmentAllowed: (a: NavigationPoint, b: NavigationPoint) => boolean = () => true,
): NavigationPoint[] | null {
  if (![sx, sy, ex, ey].every(Number.isInteger)) return null;
  if (sx === ex && sy === ey) return [{ x: sx, y: sy }];
  if (!isWalkable(ex, ey)) return null;
  const walkable: Walkable = (x, y) => (x === sx && y === sy) || isWalkable(x, y);
  type Node = NavigationPoint & { g: number; f: number; parent?: Node };
  const open: Node[] = [{ x: sx, y: sy, g: 0, f: Math.hypot(ex - sx, ey - sy) }];
  const best = new Map<string, number>([[`${sx},${sy}`, 0]]);
  let iterations = 0;
  while (open.length && iterations++ < 4096) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.g !== best.get(`${current.x},${current.y}`)) continue;
    if (current.x === ex && current.y === ey) {
      const raw: NavigationPoint[] = [];
      for (let n: Node | undefined = current; n; n = n.parent) raw.unshift({ x: n.x, y: n.y });
      const path = [raw[0]];
      for (let i = 0; i < raw.length - 1;) {
        let next = raw.length - 1;
        while (
          next > i + 1 &&
          (!clearSegment(raw[i], raw[next], walkable) || !segmentAllowed(raw[i], raw[next]))
        )
          next--;
        path.push(raw[next]);
        i = next;
      }
      return path;
    }
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = current.x + dx,
        y = current.y + dy;
      if (
        !walkable(x, y) ||
        !segmentAllowed(current, { x, y }) ||
        (dx && dy && (!walkable(current.x + dx, current.y) || !walkable(current.x, current.y + dy)))
      )
        continue;
      const g = current.g + Math.hypot(dx, dy),
        key = `${x},${y}`;
      if (g >= (best.get(key) ?? Infinity)) continue;
      best.set(key, g);
      open.push({ x, y, g, f: g + Math.hypot(ex - x, ey - y), parent: current });
    }
  }
  return null;
}
export function turnToward(current: number, target: number, deltaSeconds: number) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-14 * Math.max(0, Math.min(deltaSeconds, 0.1))));
}
