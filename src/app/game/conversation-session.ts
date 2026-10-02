import type { Segment } from "@/components/mention-input/mention-model";

/**
 * A conversation's unsent input: chips (mentions, skills) and text, so switching away and back
 * keeps a skill chip as a chip. A plain string — the shape drafts had before chips — reads back as
 * one text segment.
 */
export type ConversationSession = { draft: Segment[]; scrollTop: number };

const DRAFT_LIMIT = 500;

/** Normalizes a draft: a string becomes one text segment, and text is capped at the input limit. */
export function toDraftSegments(draft: string | Segment[] | null | undefined): Segment[] {
  const segments = typeof draft === "string" ? [{ kind: "text" as const, text: draft }] : draft;
  const out: Segment[] = [];
  let room = DRAFT_LIMIT;
  for (const s of segments ?? []) {
    if (s.kind !== "text") {
      out.push({ ...s });
      continue;
    }
    const text = s.text.slice(0, Math.max(0, room));
    room -= text.length;
    if (text) out.push({ kind: "text", text });
  }
  return out;
}

export class ConversationSessionStore {
  private readonly entries = new Map<string, ConversationSession>();

  get(key: string): ConversationSession {
    const entry = this.entries.get(key);
    return { draft: toDraftSegments(entry?.draft), scrollTop: entry?.scrollTop ?? 0 };
  }

  setDraft(key: string, draft: string | Segment[]): void {
    this.entries.set(key, { ...this.get(key), draft: toDraftSegments(draft) });
  }

  setScroll(key: string, scrollTop: number): void {
    this.entries.set(key, {
      ...this.get(key),
      scrollTop: Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0,
    });
  }

  clearDraft(key: string): void {
    this.setDraft(key, []);
  }
}
