import { setNpcActive as setNpcActiveDefault } from "../lib/npc-roster";
import { selectNpcById as selectNpcByIdDefault } from "../lib/npc-projection";

type RosterSocket = {
  id: string;
  on(event: string, handler: (payload: unknown) => unknown): void;
  emit(event: string, payload: unknown): void;
};

type RosterIo = {
  to(room: string): { emit(event: string, payload: unknown): void };
};

type MeetingRoomLike = { participants: Set<string> };

export type RegisterNpcRosterHandlersArgs = {
  io: RosterIo;
  socket: RosterSocket;
  deps: {
    /** 진행 중인 회의방 — 참가자 집합은 **사람의 socket.id** 를 담는다. */
    meetingRooms: Map<string, MeetingRoomLike>;
    /** 토론이 돌고 있는 채널 — `channelId` 하나가 키다. 이것이 "회의 중"의 정본이다. */
    activeBrokers: Map<string, unknown>;
    user: { userId: string };
    isChannelOwner: (channelId: string, userId: string) => Promise<boolean>;
    setNpcActive?: (npcId: string, active: boolean) => Promise<void>;
    selectNpcById?: (npcId: string) => Promise<{ channelId: string } | null>;
  };
};

/**
 * NPC 하나를 출근/퇴근시킨다.
 *
 * REST 가 아니라 소켓인 이유는 회의 상태가 소켓 핸들러의 클로저(`meetingRooms`·
 * `activeBrokers`)에만 있기 때문이다 — 라우트에서는 보이지 않는다. 회의 도중 참가자를
 * 맵에서 빼면 진행 중인 턴이 갈 곳을 잃으므로, 퇴근만 막는다(출근은 언제나 허용).
 *
 * "회의 중"의 판정은 `activeBrokers.has(channelId)` 다. `meetingRooms` 의 participants 는
 * 사람의 socket.id 만 담아서 NPC id 로 조회하면 **영원히 false** 이고, 그 검사만으로는
 * 가드가 한 번도 걸리지 않는다. 토론은 채널의 NPC 전체를 참가자로 잡으므로
 * (`getNpcConfigsForChannel(channelId)`), 채널 단위 판정이 곧 NPC 단위 판정이다.
 */
export function registerNpcRosterHandlers({ io, socket, deps }: RegisterNpcRosterHandlersArgs) {
  const {
    meetingRooms,
    activeBrokers,
    user,
    isChannelOwner,
    setNpcActive = setNpcActiveDefault,
    selectNpcById = selectNpcByIdDefault,
  } = deps;

  socket.on("npc:set-active", async (payload: unknown) => {
    const { channelId, npcId, active } = (payload ?? {}) as {
      channelId?: string;
      npcId?: string;
      active?: boolean;
    };
    if (!channelId || !npcId || typeof active !== "boolean") return;

    if (!(await isChannelOwner(channelId, user.userId))) {
      socket.emit("npc:set-active:error", { npcId, errorCode: "forbidden" });
      return;
    }

    // 채널 소유는 그 채널의 NPC 에게만 권한을 준다. npcId 를 검사 없이 그대로 쓰면
    // 자기 채널 하나만 가지고 남의 채널 NPC 를 퇴근시킬 수 있다.
    const target = await selectNpcById(npcId);
    if (!target || target.channelId !== channelId) {
      socket.emit("npc:set-active:error", { npcId, errorCode: "npc_not_found" });
      return;
    }

    if (!active && isMeetingInProgress(meetingRooms, activeBrokers, channelId)) {
      socket.emit("npc:set-active:error", { npcId, errorCode: "npc_in_meeting" });
      return;
    }

    await setNpcActive(npcId, active);
    const npc = await selectNpcById(npcId);
    // 채널 전체에 알린다 — 다른 뷰어의 맵도 스프라이트를 넣거나 빼야 한다.
    io.to(channelId).emit("npc:updated", { npc });
  });
}

function isMeetingInProgress(
  meetingRooms: Map<string, MeetingRoomLike>,
  activeBrokers: Map<string, unknown>,
  channelId: string,
): boolean {
  if (activeBrokers.has(channelId)) return true;
  // 사람이 회의방에 앉아 있는 동안에도 NPC 를 빼지 않는다 — 다음 발언이 곧 시작된다.
  return (meetingRooms.get(channelId)?.participants.size ?? 0) > 0;
}
