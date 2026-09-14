export type OverlayRect = { x: number; y: number; width: number; height: number };
export type ActorLabelAnchor = {
  id: string;
  x: number;
  feetY: number;
  headY: number;
  nameWidth: number;
  nameHeight: number;
  bubbleHeight?: number;
  priority: number;
};
export type ActorLabelPlacement = { name?: OverlayRect; bubble?: OverlayRect; docked?: boolean };
export const bubbleWidthFor = (width: number) => Math.max(80, Math.min(190, width - 16));
export function overlaps(a: OverlayRect, b: OverlayRect, gap = 4) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Screen-space layout only. Inputs must already be culled to visible actors. */
export function layoutActorLabels(
  anchors: readonly ActorLabelAnchor[],
  width: number,
  height: number,
) {
  const sorted = [...anchors].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const placements = new Map<string, ActorLabelPlacement>(anchors.map((a) => [a.id, {}]));
  const bubbleWidth = bubbleWidthFor(width);
  const margin = 8;
  const inside = (r: OverlayRect) =>
    r.x >= margin &&
    r.y >= margin &&
    r.x + r.width <= width - margin &&
    r.y + r.height <= height - margin;
  const centered = (x: number, y: number, w: number, h: number): OverlayRect => ({
    x: Math.max(margin, Math.min(width - margin - w, x - w / 2)),
    y,
    width: w,
    height: h,
  });
  // Leave most of the map clear even when every NPC has queued/thinking status.
  const inlineBudget = width * height * 0.24;
  const rail: OverlayRect = {
    x: width - bubbleWidth - 18,
    y: 8,
    width: bubbleWidth + 10,
    height: Math.min(168, height * 0.28),
  };
  const protectedNames: OverlayRect[] = [];
  for (const anchor of sorted.filter((a) => a.priority >= 80)) {
    const w = Math.min(anchor.nameWidth, width - margin * 2);
    for (const dy of [0, anchor.nameHeight + 5, (anchor.nameHeight + 5) * 2]) {
      const rect = centered(anchor.x, anchor.feetY + 10 + dy, w, anchor.nameHeight);
      if (inside(rect) && !protectedNames.some((r) => overlaps(r, rect))) {
        placements.get(anchor.id)!.name = rect;
        protectedNames.push(rect);
        break;
      }
    }
  }
  const railCandidates = [
    rail,
    { ...rail, x: margin },
    { ...rail, x: margin, y: height - rail.height - margin },
    { ...rail, y: height - rail.height - margin },
  ];
  const railPosition = railCandidates.find(
    (candidate) => !protectedNames.some((rect) => overlaps(rect, candidate)),
  );
  if (railPosition) Object.assign(rail, railPosition);
  const placeBubbles = (reserveRail: boolean) => {
    const occupied: OverlayRect[] = [...protectedNames, ...(reserveRail ? [rail] : [])];
    let area = 0;
    const overflow: string[] = [];
    for (const anchor of sorted) {
      const item = placements.get(anchor.id)!;
      delete item.bubble;
      delete item.docked;
      if (!anchor.bubbleHeight) continue;
      const h = anchor.bubbleHeight;
      const candidates: OverlayRect[] = [];
      // Prefer just above the actor, then nearby lanes, never across the entire map.
      for (const dy of [0, -h - 6, h + 6])
        for (const dx of [0, -bubbleWidth * 0.55, bubbleWidth * 0.55])
          candidates.push(
            centered(anchor.x + dx, Math.max(margin, anchor.headY - h - 8 + dy), bubbleWidth, h),
          );
      const rect =
        area + h * bubbleWidth <= inlineBudget
          ? candidates.find(
              (candidate) => inside(candidate) && !occupied.some((r) => overlaps(candidate, r)),
            )
          : undefined;
      if (rect) {
        item.bubble = rect;
        occupied.push(rect);
        area += h * bubbleWidth;
      } else {
        item.docked = true;
        overflow.push(anchor.id);
      }
    }
    return { occupied, overflow };
  };
  let result = placeBubbles(false);
  if (result.overflow.length) result = placeBubbles(true);
  for (const anchor of sorted) {
    if (placements.get(anchor.id)!.name) continue;
    const w = Math.min(anchor.nameWidth, width - margin * 2);
    const h = anchor.nameHeight;
    const candidates: OverlayRect[] = [];
    // Nameplates remain below the feet and close enough to identify the actor.
    for (const dy of [0, h + 5, (h + 5) * 2])
      for (const dx of [0, -w * 0.4, w * 0.4])
        candidates.push(centered(anchor.x + dx, anchor.feetY + 10 + dy, w, h));
    const rect = candidates.find(
      (candidate) => inside(candidate) && !result.occupied.some((r) => overlaps(candidate, r)),
    );
    if (rect) {
      placements.get(anchor.id)!.name = rect;
      result.occupied.push(rect);
    }
  }
  return { placements, overflow: result.overflow, rail: result.overflow.length ? rail : undefined };
}
