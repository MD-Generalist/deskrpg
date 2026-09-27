/**
 * Tab state for the staff dialog — remembers which NPC the selection belongs to.
 *
 * The existing behavior is to fall back to `chat` when switching to a different staff
 * member. Instead of resetting it in an effect, we derive it during render (`tabFor`), so
 * the previous staff member's tab never flashes for a frame.
 */

export type NpcPanelTab = "chat" | "cron" | "cards" | "skills" | "connectors";

export type NpcTabState = { npcId: string | null; tab: NpcPanelTab };

/** Only use the saved selection when it belongs to the currently open staff member — otherwise `chat`. */
export function tabFor(state: NpcTabState, dialogNpcId: string | null): NpcPanelTab {
  return state.npcId === dialogNpcId ? state.tab : "chat";
}

/**
 * An outside request to show one tab of an employee's panel — e.g. "ask in chat" from the skill
 * manager. `seq` makes each request distinct, so asking again for a tab already open still counts
 * (and refocuses the input) while a re-render with the same request changes nothing.
 */
export type NpcTabRequest = { npcId: string; tab: NpcPanelTab; seq: number };
