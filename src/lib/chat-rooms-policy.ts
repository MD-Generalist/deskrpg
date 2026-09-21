export type ReplyPolicy = "mention" | "members";
export type RoomRow = {
  id: string;
  channelId: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  createdAt: Date;
  lastMessageAt: Date | null;
};
/**
 * 방의 한 줄. `chat-rooms.ts`(서버 전용, `@/db` 를 끈다) 가 아니라 여기 있다 —
 * 클라이언트가 이 타입을 필요로 하는데, 서버 모듈에서 `import type` 으로 가져와도
 * `client-bundle-boundary.test.ts` 의 import 추적에 걸린다.
 */
export type RoomMessage = {
  id: string;
  roomId: string;
  senderKind: "user" | "npc" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  createdAt: string;
  /** 자동화 알림(칸반 카드·크론 결과)의 구조. 일반 메시지에는 없다(R29·R30). */
  notice?: RoomNotice | null;
};

/**
 * `chat_room_messages.notice_json` 의 모양. `content` 는 로케일 무관 폴백(카드 제목·결과
 * 본문)이고, 카드 렌더링에 필요한 나머지는 여기 실린다 — 서버가 한국어 문장을 굳히지
 * 않기 위해서다(시스템 메시지와 같은 원칙).
 */
export type RoomNotice =
  | {
      kind: "card_done" | "card_blocked" | "card_review";
      cardId: string;
      cardTitle: string;
      boardSlug: string;
      npcName: string;
    }
  | {
      /** 실행 전 승인 요청(설계 2026-09-21 execution-approval-gate). 버튼은 렌더러가 그린다. */
      kind: "approval_requested";
      approvalId: string;
      title: string;
      npcName: string;
      targetCount: number;
      /** 결정되면 채워진다 — 버튼 대신 결과를 그린다. 클라이언트가 숨기는 것이 아니다. */
      resolved?: { decision: string; by: string; at: string };
    }
  | {
      /**
       * NPC 가 제안한 업무 카드. 아직 카드가 아니다 — 사용자가 알림에서 등록 여부를 고르고,
       * 고른 결과가 `resolved` 로 남는다(없으면 아직 미결).
       */
      kind: "card_proposal";
      proposalId: string;
      title: string;
      summary: string;
      body?: string;
      acceptance?: string;
      npcId: string;
      npcName: string;
      resolved?: { choice: "card" | "inline"; by: string; at: string; taskId?: string };
    }
  | {
      /**
       * 후속 업무가 나온 회의가 끝났다 — "프로젝트로 등록할까요?" 를 방에 남긴다. 회의는 자동화
       * 사건이 아니라 사건 싱크를 타지 않는다. 이름이 아니라 **id 와 개수만** 싣는다(사본이 낡지 않게).
       */
      kind: "meeting_outcome";
      minutesId: string;
      topic: string;
      followUpCount: number;
      recommended: boolean;
      /** 등록되면 채워진다 — 버튼 대신 결과를 그린다. */
      resolved?: {
        boardSlug: string;
        tenant: string | null;
        taskCount: number;
        by: string;
        at: string;
      };
    }
  | {
      kind: "cron_result";
      jobId: string;
      jobName: string;
      npcName: string;
      status: "ok" | "error";
    };

const ROOM_NOTICE_KINDS = new Set([
  "card_done",
  "card_blocked",
  "card_review",
  "approval_requested",
  "card_proposal",
  "meeting_outcome",
  "cron_result",
]);

/** 저장된 JSON 문자열을 되읽는다. 깨진 값·모르는 kind 는 null — 메시지 자체는 살린다. */
export function parseRoomNotice(raw: string | null | undefined): RoomNotice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = (parsed as { kind?: unknown }).kind;
    return typeof kind === "string" && ROOM_NOTICE_KINDS.has(kind) ? (parsed as RoomNotice) : null;
  } catch {
    return null;
  }
}

export type RoomSummary = {
  id: string;
  kind: "office" | "group";
  name: string;
  replyPolicy: ReplyPolicy;
  createdBy: string;
  lastMessageAt: string | null;
  members: { kind: "user" | "npc"; id: string; name: string }[];
  lastMessage?: { senderName: string; content: string; createdAt: string };
};

/** 방 정책 × 지명 → 이번 메시지에 대답할 NPC. office(mention)는 지명만, group(members)는 전원 또는 지명된 부분집합. */
export function decideResponders(
  policy: ReplyPolicy,
  mentionedIds: string[],
  memberNpcIds: string[],
): string[] {
  const members = new Set(memberNpcIds);
  const mentioned = mentionedIds.filter((id) => members.has(id));
  if (policy === "mention") return mentioned;
  return mentionedIds.length > 0 ? mentioned : [...memberNpcIds];
}

export function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "office" ? -1 : 1;
    return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
  });
}

export type RoomAccess =
  { ok: true; room: RoomRow } | { ok: false; code: "not_found" | "forbidden" };
export function resolveRoomAccessDecision(args: {
  room: RoomRow | null;
  channelAllowed: boolean;
  isMember: boolean;
}): RoomAccess {
  if (!args.room) return { ok: false, code: "not_found" };
  if (!args.channelAllowed) return { ok: false, code: "forbidden" };
  if (args.room.kind === "group" && !args.isMember) return { ok: false, code: "forbidden" };
  return { ok: true, room: args.room };
}
