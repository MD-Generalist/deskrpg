/** Contours of orthogonal, hole-free cell footprints (including U/L shapes).
 * Diagonal-only joins and enclosed courtyards are rejected, never silently filled. */
export type FloorPoint = { x: number; z: number };
export function floorContours(floor: readonly (readonly number[])[]): FloorPoint[][] {
  const filled = (x: number, z: number) => !!floor[z]?.[x];
  for (let z = 0; z < floor.length - 1; z++)
    for (let x = 0; x < floor[z].length - 1; x++) {
      const a = filled(x, z),
        b = filled(x + 1, z),
        c = filled(x, z + 1),
        d = filled(x + 1, z + 1);
      if (a === d && b === c && a !== b)
        throw new Error("Diagonal-only office floor join is unsupported");
    }
  const key = (p: FloorPoint) => `${p.x},${p.z}`;
  const edges = new Map<string, FloorPoint>();
  for (let z = 0; z < floor.length; z++)
    for (let x = 0; x < floor[z].length; x++) {
      if (!filled(x, z)) continue;
      if (!filled(x, z - 1)) edges.set(key({ x, z }), { x: x + 1, z });
      if (!filled(x + 1, z)) edges.set(key({ x: x + 1, z }), { x: x + 1, z: z + 1 });
      if (!filled(x, z + 1)) edges.set(key({ x: x + 1, z: z + 1 }), { x, z: z + 1 });
      if (!filled(x - 1, z)) edges.set(key({ x, z: z + 1 }), { x, z });
    }
  const loops: FloorPoint[][] = [];
  while (edges.size) {
    const first = edges.keys().next().value!;
    const [x, z] = first.split(",").map(Number);
    const points: FloorPoint[] = [{ x, z }];
    let next = edges.get(first)!;
    edges.delete(first);
    while (key(next) !== first) {
      points.push(next);
      const k = key(next),
        following = edges.get(k);
      if (!following) throw new Error("Non-manifold office floor");
      edges.delete(k);
      next = following;
    }
    const area = points.reduce((sum, p, i) => {
      const b = points[(i + 1) % points.length];
      return sum + p.x * b.z - b.x * p.z;
    }, 0);
    if (area < 0) throw new Error("Enclosed office courtyards require a hole-aware slab renderer");
    loops.push(
      points.filter((p, i) => {
        const a = points[(i + points.length - 1) % points.length],
          b = points[(i + 1) % points.length];
        return (p.x - a.x) * (b.z - p.z) !== (p.z - a.z) * (b.x - p.x);
      }),
    );
  }
  return loops;
}
/** Axis-aligned miters, preserving both convex and concave joins. */
export function insetContour(points: readonly FloorPoint[], inset: number): FloorPoint[] {
  return points.map((p, i) => {
    const a = points[(i + points.length - 1) % points.length],
      b = points[(i + 1) % points.length];
    const ax = Math.sign(p.x - a.x),
      az = Math.sign(p.z - a.z),
      bx = Math.sign(b.x - p.x),
      bz = Math.sign(b.z - p.z);
    return { x: p.x - inset * (az + bz), z: p.z + inset * (ax + bx) };
  });
}
