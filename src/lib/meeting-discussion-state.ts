/** Public, credential-free roster resolved by the meeting broker. */
export type MeetingDiscussionState = {
  topic: string;
  npcs: Array<{ id: string; name: string }>;
  mode: "auto" | "manual" | "directed";
  initiatorId: string;
  initiatorSocketId: string;
  isWaitingInput?: boolean;
  currentSpeaker?: { npcId: string; npcName: string } | null;
  /** Raw partial output; display sanitization belongs to the client. */
  rawStreams?: Record<string, string>;
};

export function restoreMeetingNpcs<T extends { id: string; name: string; appearance: unknown }>(
  roster: MeetingDiscussionState["npcs"],
  catalog: readonly T[],
): Array<{ id: string; name: string; appearance: unknown }> {
  return roster.map((npc) => ({
    ...npc,
    appearance: catalog.find((entry) => entry.id === npc.id)?.appearance ?? null,
  }));
}
