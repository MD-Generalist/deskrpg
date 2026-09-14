import type { Socket } from "socket.io";

type NpcUpdate = {
  id: string;
  channelId: string;
  name: string;
  positionX: number | null;
  positionY: number | null;
  direction: string | null;
  appearance: unknown;
  active: boolean;
};

/** All asynchronous work belongs to the admitted player and map generation.
 * An old read cannot publish homes into a newly bootstrapped scene. */
export async function broadcastNpcUpdate(
  socket: Socket,
  data: unknown,
  dependencies: {
    getPlayer(): { mapId: string } | undefined;
    admittedRevision(): string | undefined;
    generation(id: string): number;
    isPaused(id: string): boolean;
    requiresRefresh(): boolean;
    selectNpc(id: string): Promise<NpcUpdate | null>;
    readRevision(id: string): Promise<string | null>;
    invalidate(id: string): Promise<void>;
    invalidateRooms(id: string): void;
  },
) {
  const player = dependencies.getPlayer();
  const revision = dependencies.admittedRevision();
  if (!player || !revision || !data || typeof data !== "object") return;
  const channelId = player.mapId;
  const generation = dependencies.generation(channelId);
  const current = () =>
    socket.connected &&
    socket.rooms.has(channelId) &&
    dependencies.getPlayer() === player &&
    dependencies.admittedRevision() === revision &&
    !dependencies.requiresRefresh() &&
    !dependencies.isPaused(channelId) &&
    dependencies.generation(channelId) === generation;
  if (!current()) return;
  const payload = data as { npcId?: string; npc?: { id?: string } };
  const npcId = payload.npcId ?? payload.npc?.id;
  if (typeof npcId !== "string") return;
  try {
    const npc = await dependencies.selectNpc(npcId);
    if (!current() || !npc || npc.channelId !== channelId) return;
    const selectedRevision = await dependencies.readRevision(channelId);
    if (!current() || selectedRevision !== revision) return;
    dependencies.invalidateRooms(channelId);
    await dependencies.invalidate(channelId);
    if (!current()) return;
    const finalRevision = await dependencies.readRevision(channelId);
    if (!current() || finalRevision !== revision) return;
    socket.to(channelId).emit("npc:updated", {
      npc: {
        id: npc.id,
        name: npc.name,
        positionX: npc.positionX,
        positionY: npc.positionY,
        direction: npc.direction,
        appearance: npc.appearance,
        active: npc.active,
      },
    });
  } catch {
    // Failed reads or invalidations have no authoritative update to publish.
  }
}
