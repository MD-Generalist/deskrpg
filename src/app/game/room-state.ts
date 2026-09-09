import { sortRooms, type RoomMessage, type RoomSummary } from "@/lib/chat-rooms-policy";

/**
 * 채널 대화방 화면의 상태. 순수 리듀서라 소켓·React 를 모른다 — `node:test` 가 붙는다.
 *
 * `view` 는 세 화면이다: 방 목록(`list`), 방 안(`room`), 새 방/초대 작성(`compose`).
 * office 방 하나뿐인 채널은 목록이 의미가 없으므로 `showList` 가 방에 머문다.
 */
export type RoomState = {
  rooms: RoomSummary[];
  currentRoomId: string | null;
  messages: Record<string, RoomMessage[]>;
  view: "list" | "room" | "compose";
  compose?: { presetNpcIds: string[]; inviteTo?: string };
};

export type RoomAction =
  | { type: "list"; rooms: RoomSummary[]; preferRoomId: string | null }
  | { type: "history"; roomId: string; messages: RoomMessage[] }
  | { type: "message"; roomId: string; message: RoomMessage }
  | { type: "created" | "updated"; room: RoomSummary; enter: boolean }
  | { type: "deleted"; roomId: string }
  | { type: "open"; roomId: string }
  | { type: "showList" }
  | { type: "compose"; presetNpcIds: string[]; inviteTo?: string };

export const initialRoomState: RoomState = {
  rooms: [],
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
      if (previous.some((message) => message.id === action.message.id)) return state;
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
      // 방이 하나뿐이면 목록은 빈 화면이나 다름없다 — 그 방에 머문다.
      return { ...state, view: state.rooms.length > 1 ? "list" : "room", compose: undefined };

    case "compose":
      return {
        ...state,
        view: "compose",
        compose: { presetNpcIds: action.presetNpcIds, inviteTo: action.inviteTo },
      };
  }
}
