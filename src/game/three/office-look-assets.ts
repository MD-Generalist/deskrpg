/** Asset names preserve saved officeLookId values across every rendering surface. */
export function officeLookAssetUrl(officeLookId: string): string {
  return `/assets/characters/office/${encodeURIComponent(officeLookId)}.glb`;
}
