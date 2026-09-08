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

/** 토론 브로커 — `config.participants` 가 이 회의에 실제로 앉은 NPC 의 정본이다. */
type MeetingBrokerLike = { config: { participants: Array<{ npcId: string }> } };

export type RegisterNpcRosterHandlersArgs = {
  io: RosterIo;
  socket: RosterSocket;
  deps: {
    /** 토론이 돌고 있는 채널 — `channelId` 하나가 키다. 값이 참가자 명단을 들고 있다. */
    activeBrokers: Map<string, MeetingBrokerLike>;
    user: { userId: string };
    isChannelOwner: (channelId: string, userId: string) => Promise<boolean>;
    setNpcActive?: (npcId: string, active: boolean) => Promise<void>;
    selectNpcById?: (npcId: string) => Promise<{ channelId: string } | null>;
  };
};

/**
 * NPC 하나를 출근/퇴근시킨다.
 *
 * REST 가 아니라 소켓인 이유는 회의 상태가 소켓 핸들러의 클로저(`activeBrokers`)에만
 * 있기 때문이다 — 라우트에서는 보이지 않는다. 회의 도중 참가자를 맵에서 빼면 진행 중인
 * 턴이 갈 곳을 잃으므로, 퇴근만 막는다(출근은 언제나 허용).
 *
 * "이 NPC 가 회의 중인가" 의 정본은 **브로커의 `config.participants`** 다. 토론은 채널의
 * NPC 전체를 잡지 않는다 — `start-discussion` 이 `selectedNpcIds` 로 걸러낸 부분집합만
 * 참가자가 된다(meeting-discussion.ts:477-480). 그래서 채널 단위 판정
 * (`activeBrokers.has(channelId)`)은 회의에 부르지 않은 NPC 까지 함께 묶어 버린다.
 *
 * `meetingRooms` 의 participants 는 **사람의 socket.id** 이고 여기에 쓰면 안 된다.
 * NPC id 로 조회하면 영원히 false 이고, 반대로 "비어 있지 않은가" 로 보면 회의 패널을
 * 열어 둔 사람 하나가 소유자의 퇴근을 무기한 막는다(방은 지워지지 않는다).
 */
export function registerNpcRosterHandlers({ io, socket, deps }: RegisterNpcRosterHandlersArgs) {
  const {
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

    if (!active && isNpcInMeeting(activeBrokers, channelId, npcId)) {
      socket.emit("npc:set-active:error", { npcId, errorCode: "npc_in_meeting" });
      return;
    }

    await setNpcActive(npcId, active);
    const npc = await selectNpcById(npcId);
    // 채널 전체에 알린다 — 다른 뷰어의 맵도 스프라이트를 넣거나 빼야 한다.
    io.to(channelId).emit("npc:updated", { npc });
  });
}

function isNpcInMeeting(
  activeBrokers: Map<string, MeetingBrokerLike>,
  channelId: string,
  npcId: string,
): boolean {
  const participants = activeBrokers.get(channelId)?.config.participants;
  return participants?.some((p) => p.npcId === npcId) ?? false;
}
