import type { ConversationSelection } from "./conversation-selection";

export type ConversationEntryEvent =
  { type: "npc"; npcId: string; npcName: string } | { type: "public-room"; roomId: string };

export function selectionForEvent(event: ConversationEntryEvent): ConversationSelection {
  if (event.type === "npc") {
    return { kind: "npc", npcId: event.npcId, npcName: event.npcName };
  }
  return { kind: "room", roomId: event.roomId };
}

export type NavigatorMotion = "idle" | "moving" | "waiting" | "resting" | "unplaced";

export function navigatorMotion(value: {
  active: boolean;
  placed: boolean;
  phase?: string;
}): NavigatorMotion {
  if (!value.active) return "resting";
  if (!value.placed) return "unplaced";
  if (value.phase === "waiting") return "waiting";
  if (value.phase === "moving-to-player" || value.phase === "returning") return "moving";
  return "idle";
}
