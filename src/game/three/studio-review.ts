import { CREATIVE_STUDIO_ZONES } from "./creative-studio-layout";
import { findPath, clearSegment } from "../navigation";
import type { ActorSnapshot } from "./bridge";
const labels: Record<string, string> = {
  photo: "포토 베이",
  workstations: "워크스테이션",
  ideation: "아이디어 공간",
  "main-lounge": "메인 라운지",
  production: "제작 공간",
  "studio-director": "스튜디오 대표실",
  meeting: "미팅룸",
  pantry: "팬트리",
  "small-lounge": "작은 라운지",
};
export const studioReviewRooms = CREATIVE_STUDIO_ZONES.map((z) => ({
  id: z.id,
  label: labels[z.id],
  x: z.x + z.width / 2,
  z: z.y + z.height / 2,
  distance: Math.max(z.width, z.height) * 1.15,
}));
export const studioReviewSeatIndices = [0, 3, 5, 8, 12, 15, 18, 23, 26, 31, 35, 37];
export function createReviewWalk(
  actor: ActorSnapshot,
  x: number,
  y: number,
  walkable: (x: number, y: number) => boolean,
) {
  if (![actor.x, actor.y, x, y].every(Number.isFinite)) return null;
  const target = { x: Math.floor(x / 32), y: Math.floor(y / 32) };
  if (!walkable(target.x, target.y)) return null;
  const source = { x: actor.x / 32 - 0.5, y: actor.y / 32 - 0.5 };
  const candidates = Array.from({ length: 9 }, (_, i) => ({
    x: Math.floor(actor.x / 32) + (i % 3) - 1,
    y: Math.floor(actor.y / 32) + Math.floor(i / 3) - 1,
  }))
    .filter((p) => walkable(p.x, p.y) && clearSegment(source, p, walkable))
    .sort(
      (a, b) =>
        Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y),
    );
  let points: (typeof source)[] | null = null;
  for (const start of candidates) {
    const path = findPath(start.x, start.y, target.x, target.y, walkable, (a, b) =>
      clearSegment(a, b, walkable),
    );
    if (!path) continue;
    // Preserve the fractional in-flight position and connect to the furthest
    // body-clear point on the new integer route, avoiding a snap/backtrack.
    let join = path.length - 1;
    while (join > 0 && !clearSegment(source, path[join], walkable)) join--;
    points = [source, ...path.slice(join)];
    if (points.length > 1 && points[0].x === points[1].x && points[0].y === points[1].y)
      points.shift();
    break;
  }
  if (!points) return null;
  x = (target.x + 0.5) * 32;
  y = (target.y + 0.5) * 32;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  return { actor, points, lengths, total: lengths.reduce((a, b) => a + b, 0), x, y };
}
export function sampleReviewWalk(
  route: NonNullable<ReturnType<typeof createReviewWalk>>,
  seconds: number,
): ActorSnapshot {
  let distance = Math.max(0, seconds) * 1.6;
  if (distance >= route.total) return { ...route.actor, x: route.x, y: route.y, walking: false };
  let i = 0;
  while (i < route.lengths.length - 1 && distance > route.lengths[i])
    distance -= route.lengths[i++];
  const a = route.points[i],
    b = route.points[i + 1],
    t = distance / route.lengths[i];
  return {
    ...route.actor,
    x: (a.x + (b.x - a.x) * t + 0.5) * 32,
    y: (a.y + (b.y - a.y) * t + 0.5) * 32,
    walking: true,
    direction:
      Math.abs(b.x - a.x) > Math.abs(b.y - a.y)
        ? b.x > a.x
          ? "right"
          : "left"
        : b.y > a.y
          ? "down"
          : "up",
  };
}
