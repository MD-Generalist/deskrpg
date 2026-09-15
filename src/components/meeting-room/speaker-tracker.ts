import type { MeetingSpeaker } from "@/game/three/meeting-camera";

/** 실제 출력이 시작될 때만 카메라 발언을 만들고 같은 발언의 조각은 무시한다. */
export class MeetingSpeakerTracker {
  private serial = 0;
  private currentNpc: string | null = null;
  constructor(private emit: (speaker: MeetingSpeaker | null) => void) {}
  turn(_npcId: string) {
    this.currentNpc = null;
    this.emit(null);
  }
  stream(npcId: string, visibleText: string) {
    if (!visibleText.trim() || this.currentNpc === npcId) return;
    this.currentNpc = npcId;
    this.emit({ kind: "npc", id: npcId, utteranceId: `npc:${npcId}:${++this.serial}` });
  }
  finish(npcId?: string) {
    if (npcId && this.currentNpc && npcId !== this.currentNpc) return;
    this.currentNpc = null;
    this.emit(null);
  }
  user(socketId: string, utteranceId: string, roster: Array<{ id: string; userId?: string }>) {
    this.currentNpc = null;
    const id = roster.find((participant) => participant.id === socketId)?.userId;
    this.emit(id ? { kind: "user", id, utteranceId } : null);
  }
}
