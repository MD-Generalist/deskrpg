// 제거 예정: 유일한 호출부 NpcHireModal 이 Task 9 에서 삭제된다.
// Pure predicate for whether NpcHireModal's submit handler should call
// POST /api/npcs/{id}/rebind before saving. Extracted so the decision gating a
// live-credential mutation is unit-tested, not buried inline in the event handler.

export function shouldRebindProfile(
  adapterType: string,
  selectedProfileId: string | null,
  currentProfileId: string | null | undefined,
): boolean {
  if (adapterType !== "hermes") return false;
  if (!selectedProfileId) return false;
  return selectedProfileId !== currentProfileId;
}
