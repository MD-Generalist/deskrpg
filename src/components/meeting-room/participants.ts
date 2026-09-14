/** Copy the selected roster at start so later form/catalog changes cannot expand a running meeting. */
export function selectMeetingNpcs<T extends { id: string }>(
  npcs: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return npcs.filter((npc) => selectedIds.has(npc.id));
}

/** User identity survives reconnects; local socket/seat position does not identify the chair. */
export function isMeetingChair(
  participant: { type: "user" | "npc"; userId?: string } | undefined,
  initiatorUserId: string | null,
): boolean {
  return Boolean(
    initiatorUserId && participant?.type === "user" && participant.userId === initiatorUserId,
  );
}
