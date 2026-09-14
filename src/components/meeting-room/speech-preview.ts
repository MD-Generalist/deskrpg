// Keep the sentence beginning. The bubble clamps by rendered lines, not character count.
export function buildSpeechBubblePreview(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
