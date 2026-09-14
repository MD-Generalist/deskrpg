export type ConversationSelection =
  | { kind: "none" }
  | { kind: "room"; roomId: string }
  | { kind: "npc"; npcId: string; npcName: string }
  | { kind: "meeting" }
  | {
      kind: "compose";
      mode: "create" | "invite";
      roomId?: string;
      presetNpcIds: string[];
    };

export const initialConversationSelection: ConversationSelection = { kind: "none" };

export const selectRoom = (
  _current: ConversationSelection,
  roomId: string,
): ConversationSelection => ({ kind: "room", roomId });

export const selectNpc = (
  _current: ConversationSelection,
  npcId: string,
  npcName: string,
): ConversationSelection => ({ kind: "npc", npcId, npcName });

export const selectMeeting = (_current: ConversationSelection): ConversationSelection => ({
  kind: "meeting",
});

export const closeConversation = (_current: ConversationSelection): ConversationSelection => ({
  kind: "none",
});

export function selectionKey(value: ConversationSelection): string {
  switch (value.kind) {
    case "room":
      return `room:${value.roomId}`;
    case "npc":
      return `npc:${value.npcId}`;
    case "compose":
      return `compose:${value.mode}:${value.roomId ?? "new"}`;
    default:
      return value.kind;
  }
}
