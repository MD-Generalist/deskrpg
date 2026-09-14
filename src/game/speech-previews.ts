/** Local presentation only; never adds dialogue to an AI context. */
export class SpeechPreviews {
  private entries = new Map<string, { text: string; until: number }>();

  set(actorId: string, content: string, now: number): void {
    const text = content.replace(/\s+/gu, " ").trim();
    if (!text) return;
    // Bound DOM/layout work; CSS applies the actual three-line ellipsis.
    const chars = Array.from(text);
    this.entries.set(actorId, {
      text: chars.length > 240 ? chars.slice(0, 237).join("") + "..." : text,
      until: now + 12000,
    });
  }

  get(actorId: string, now: number): string | undefined {
    const entry = this.entries.get(actorId);
    if (!entry) return undefined;
    if (now >= entry.until) {
      this.entries.delete(actorId);
      return undefined;
    }
    return entry.text;
  }
}
