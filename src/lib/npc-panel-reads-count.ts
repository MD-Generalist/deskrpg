/** 담당 카드 중 아직 보지 않은 것의 수. */
export function unseenCardCount(assignedIds: string[], seenIds: string[]): number {
  const seen = new Set(seenIds);
  return assignedIds.filter((id) => !seen.has(id)).length;
}

/**
 * 본 id 집합을 현재 담당 카드와 교집합으로 줄인다.
 * `KanbanTask` 에 `updated_at` 이 없어 시각 워터마크를 쓸 수 없고, 그래서 id 를 쌓는다 —
 * 가지치지 않으면 무한히 자란다. 담당에서 빠진 카드는 다시 보일 일이 없으니 버려도 된다.
 */
export function pruneSeenIds(assignedIds: string[], seenIds: string[]): string[] {
  const assigned = new Set(assignedIds);
  return seenIds.filter((id) => assigned.has(id));
}

/** `seenAt` 보다 나중인 크론 알림의 수. 같은 시각은 이미 본 것이다. */
export function unseenCronCount(noticeTimes: string[], seenAt: string | null): number {
  if (!seenAt) return noticeTimes.length;
  return noticeTimes.filter((t) => t > seenAt).length;
}
