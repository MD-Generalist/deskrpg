export type ConversationSession = { draft: string; scrollTop: number };

const EMPTY_SESSION: ConversationSession = { draft: "", scrollTop: 0 };

export class ConversationSessionStore {
  private readonly entries = new Map<string, ConversationSession>();

  get(key: string): ConversationSession {
    return { ...(this.entries.get(key) ?? EMPTY_SESSION) };
  }

  setDraft(key: string, draft: string): void {
    this.entries.set(key, { ...this.get(key), draft: draft.slice(0, 500) });
  }

  setScroll(key: string, scrollTop: number): void {
    this.entries.set(key, {
      ...this.get(key),
      scrollTop: Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0,
    });
  }

  clearDraft(key: string): void {
    this.setDraft(key, "");
  }
}
