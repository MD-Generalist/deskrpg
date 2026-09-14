export type NpcCallOwner = { ownerId: string; returning: boolean };
/** Tracks call ownership from authoritative snapshots and compatible call/return events. */
export class NpcMovementOwnership {
  private claims = new Map<string, NpcCallOwner>();
  owner(npcId: string) {
    return this.claims.get(npcId)?.ownerId;
  }
  claim(npcId: string, ownerId: string) {
    const changed = this.owner(npcId) !== ownerId;
    if (changed) this.claims.set(npcId, { ownerId, returning: false });
    return changed;
  }
  startReturn(npcId: string) {
    const claim = this.claims.get(npcId);
    if (!claim) return false;
    claim.returning = true;
    return true;
  }
  mayRoam(npcId: string, leader: boolean) {
    return leader && !this.claims.has(npcId);
  }
  mayDrive(npcId: string, localId: string | undefined, leader: boolean) {
    if (!localId) return false;
    const owner = this.owner(npcId);
    return owner ? owner === localId : leader;
  }
  finishReturn(npcId: string, position: { x: number; y: number }, home: { x: number; y: number }) {
    if (
      !this.claims.get(npcId)?.returning ||
      !(Math.hypot(position.x - home.x, position.y - home.y) < 2)
    )
      return false;
    this.claims.delete(npcId);
    return true;
  }
  releaseOwner(ownerId: string) {
    const released: string[] = [];
    for (const [npcId, claim] of this.claims)
      if (claim.ownerId === ownerId) {
        this.claims.delete(npcId);
        released.push(npcId);
      }
    return released;
  }
  clear(npcId?: string) {
    if (npcId) this.claims.delete(npcId);
    else this.claims.clear();
  }
}
/** Final position must arrive before the existing stop event; followers can then release ownership. */
export function publishNpcArrival(
  emit: (
    event: "npc:position-update" | "npc:arrived",
    payload: { channelId: string; npcId: string; x?: number; y?: number; direction?: string },
  ) => void,
  position: { channelId: string; npcId: string; x: number; y: number; direction: string },
) {
  emit("npc:position-update", position);
  emit("npc:arrived", { channelId: position.channelId, npcId: position.npcId });
}
