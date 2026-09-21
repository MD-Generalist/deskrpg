import { sortRooms, type RoomMessage, type RoomSummary } from "@/lib/chat-rooms-policy";

/**
 * 채널 대화방 화면의 상태. 순수 리듀서라 소켓·React 를 모른다 — `node:test` 가 붙는다.
 *
 * `view` 는 세 화면이다: 방 목록(`list`), 방 안(`room`), 새 방/초대 작성(`compose`).
 * 목록은 방이 하나여도 새 방 만들기의 진입점이다.
 */
export type RoomState = {
  rooms: RoomSummary[];
  /**
   * 이 브라우저를 쓰는 사람의 user id. 서버가 `room:list-response` 에 실어 준다 —
   * 클라이언트는 달리 자기 신원을 알 수 없고, 이게 없으면 "내가 만든 방" 을 가릴 수 없다.
   */
  viewerUserId: string | null;
  currentRoomId: string | null;
  messages: Record<string, RoomMessage[]>;
  view: "list" | "room" | "compose";
  compose?: { presetNpcIds: string[]; inviteTo?: string };
};

export type RoomAction =
  | {
      type: "list";
      rooms: RoomSummary[];
      preferRoomId: string | null;
      viewerUserId?: string | null;
    }
  | { type: "history"; roomId: string; messages: RoomMessage[] }
  | { type: "message"; roomId: string; message: RoomMessage }
  | { type: "created" | "updated"; room: RoomSummary; enter: boolean }
  | { type: "deleted"; roomId: string }
  | { type: "open"; roomId: string }
  | { type: "showList" }
  | { type: "compose"; presetNpcIds: string[]; inviteTo?: string };

export const initialRoomState: RoomState = {
  rooms: [],
  viewerUserId: null,
  currentRoomId: null,
  messages: {},
  view: "list",
};

/** 폴백 방: office 가 있으면 office, 없으면 정렬 뒤 첫 방. */
function fallbackRoomId(rooms: RoomSummary[]): string | null {
  return (rooms.find((room) => room.kind === "office") ?? rooms[0])?.id ?? null;
}

export function lastRoomKey(channelId: string): string {
  return `deskrpg.lastRoom.${channelId}`;
}

export function reduceRoomState(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "list": {
      const rooms = sortRooms(action.rooms);
      const preferred = rooms.some((room) => room.id === action.preferRoomId)
        ? action.preferRoomId
        : null;
      const currentRoomId = preferred ?? fallbackRoomId(rooms);
      return {
        ...state,
        rooms,
        // 옛 서버는 이 값을 보내지 않는다 — 그때는 이미 알던 것을 지우지 않는다.
        viewerUserId: action.viewerUserId ?? state.viewerUserId,
        currentRoomId,
        view: currentRoomId ? "room" : "list",
        compose: undefined,
      };
    }

    case "history":
      return { ...state, messages: { ...state.messages, [action.roomId]: action.messages } };

    case "message": {
      const previous = state.messages[action.roomId] ?? [];
      // 같은 메시지가 두 번 오는 경로가 실제로 있다 — 히스토리를 받은 직후에
      // 그 마지막 줄의 브로드캐스트가 도착하면 화면에 두 번 찍힌다.
      const existing = previous.find((message) => message.id === action.message.id);
      if (existing) {
        // 같은 줄이 **해소된 알림**으로 다시 왔으면 제자리에서 갈아 끼운다(등록·승인 뒤 서버가 같은 id 로
        // 되쓴 줄을 방송한다). 순서·미리보기는 건드리지 않는다 — 새 메시지가 아니다.
        if (
          JSON.stringify(existing.notice ?? null) === JSON.stringify(action.message.notice ?? null)
        )
          return state;
        return {
          ...state,
          messages: {
            ...state.messages,
            [action.roomId]: previous.map((message) =>
              message.id === action.message.id
                ? { ...message, notice: action.message.notice }
                : message,
            ),
          },
        };
      }
      const rooms = sortRooms(
        state.rooms.map((room) =>
          room.id === action.roomId
            ? {
                ...room,
                lastMessageAt: action.message.createdAt,
                lastMessage: {
                  senderName: action.message.senderName,
                  content: action.message.content,
                  createdAt: action.message.createdAt,
                },
              }
            : room,
        ),
      );
      return {
        ...state,
        rooms,
        messages: { ...state.messages, [action.roomId]: [...previous, action.message] },
      };
    }

    case "created":
    case "updated": {
      const known = state.rooms.some((room) => room.id === action.room.id);
      const rooms = sortRooms(
        known
          ? state.rooms.map((room) => (room.id === action.room.id ? action.room : room))
          : [...state.rooms, action.room],
      );
      if (!action.enter) return { ...state, rooms };
      return { ...state, rooms, currentRoomId: action.room.id, view: "room", compose: undefined };
    }

    case "deleted": {
      const rooms = state.rooms.filter((room) => room.id !== action.roomId);
      const messages = { ...state.messages };
      delete messages[action.roomId];
      if (state.currentRoomId !== action.roomId) return { ...state, rooms, messages };
      const currentRoomId = fallbackRoomId(rooms);
      return {
        ...state,
        rooms,
        messages,
        currentRoomId,
        view: currentRoomId ? "room" : "list",
        compose: undefined,
      };
    }

    case "open":
      return { ...state, currentRoomId: action.roomId, view: "room", compose: undefined };

    case "showList":
      // 단일 office 채널에서도 새 방 만들기에 접근할 수 있다.
      return { ...state, view: "list", compose: undefined };

    case "compose":
      return {
        ...state,
        view: "compose",
        compose: { presetNpcIds: action.presetNpcIds, inviteTo: action.inviteTo },
      };
  }
}
