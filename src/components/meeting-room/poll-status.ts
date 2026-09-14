export interface PollRaiseItem {
  name: string;
  reason?: string;
}

export function formatPollRaises(raises: Array<string | PollRaiseItem> | undefined): string[] {
  if (!Array.isArray(raises)) return [];

  return raises
    .map((raise) => {
      if (typeof raise === "string") return raise;
      if (raise && typeof raise.name === "string") return raise.name;
      return null;
    })
    .filter((name): name is string => Boolean(name));
}

/** Broker passes contain NPC IDs; legacy payloads may already contain display names. */
export function formatPollPasses(
  passes: readonly string[] | undefined,
  npcs: readonly { id: string; name: string }[],
  unknownName: string,
): string[] {
  const names = new Map(npcs.map((npc) => [npc.id, npc.name]));
  return (passes ?? []).map(
    (value) => names.get(value) ?? (npcs.some((npc) => npc.name === value) ? value : unknownName),
  );
}
