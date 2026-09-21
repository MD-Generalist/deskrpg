/**
 * 회의 결과 방 알림 — 후속 업무가 나온 회의가 끝나면 사무실 방에 한 줄을 남긴다.
 *
 * 회의는 자동화 사건이 아니다(Hermes 사건 스트림·커서를 거치지 않는다). 그래서 사건 싱크(`ingest`)가
 * 아니라 승인 알림과 같은 길로 낸다: 행은 `appendRoomMessage` 가 쓰고 방송은 `automation-registry` 훅.
 *
 * **여기 함수들은 던지지 않는다.** 알림이 늦게 보이는 것과 회의록이 안 남는 것·등록이 실패하는 것은
 * 무게가 다르다.
 */
import { requestEmitRoomMessage } from "@/lib/automation-registry";
import { appendRoomMessage, ensureOfficeRoom, getChannelOwnerId } from "@/lib/chat-rooms";
import type { RoomNotice } from "@/lib/chat-rooms-policy";
import type {
  MeetingOutcome,
  MeetingOutcomeRegistered,
  MeetingSummaryStatus,
} from "@/lib/meeting-outcome";
import { rewriteRoomNotices } from "@/lib/room-notice-rewrite";

export type MeetingOutcomeNotice = Extract<RoomNotice, { kind: "meeting_outcome" }>;

/**
 * 조건은 "회의가 끝났는가" 가 아니라 **"등록할 후속 업무가 있는가"** 다. 요약 실패는 0건과 다르지만
 * 방에 남기지 않는다 — 다시 시도는 회의 화면·회의록이 권한다.
 */
export function shouldAnnounceOutcome(
  outcome: MeetingOutcome | null | undefined,
  summaryStatus: MeetingSummaryStatus,
): boolean {
  return summaryStatus === "ok" && !!outcome && outcome.followUps.length > 0;
}

/** id 와 개수만 싣는다. 프로젝트·서브프로젝트 이름은 바뀔 수 있어 사본을 두지 않는다. */
export function buildMeetingOutcomeNotice(input: {
  minutesId: string;
  topic: string;
  outcome: MeetingOutcome;
}): MeetingOutcomeNotice {
  return {
    kind: "meeting_outcome",
    minutesId: input.minutesId,
    topic: input.topic,
    followUpCount: input.outcome.followUps.length,
    recommended: input.outcome.project?.recommended === true,
  };
}

export async function announceMeetingOutcome(input: {
  channelId: string;
  minutesId: string | null | undefined;
  topic: string;
  outcome: MeetingOutcome | null | undefined;
  summaryStatus: MeetingSummaryStatus;
}): Promise<void> {
  try {
    if (!input.minutesId || !input.outcome) return;
    if (!shouldAnnounceOutcome(input.outcome, input.summaryStatus)) return;
    const ownerId = await getChannelOwnerId(input.channelId);
    if (!ownerId) return;
    const room = await ensureOfficeRoom(input.channelId, ownerId);
    const message = await appendRoomMessage({
      roomId: room.id,
      senderKind: "system",
      senderId: null,
      senderName: "",
      // 로케일 무관 폴백. 문장은 보는 사람의 언어로 렌더러가 만든다.
      content: input.topic,
      notice: buildMeetingOutcomeNotice({
        minutesId: input.minutesId,
        topic: input.topic,
        outcome: input.outcome,
      }),
    });
    requestEmitRoomMessage(room.id, message);
  } catch (error) {
    console.warn("[meeting] 회의 결과 알림을 남기지 못했다", { channelId: input.channelId }, error);
  }
}

/**
 * 등록이 끝나면 **같은 줄**에 결과를 되쓴다 — 렌더러가 회의록을 다시 읽지 않고, 과거 메시지를
 * 스크롤해도 그때의 결과가 보인다. 해소 여부를 클라이언트가 숨기는 것이 아니다.
 */
export async function markMeetingOutcomeNoticeRegistered(input: {
  channelId: string;
  minutesId: string;
  registered: MeetingOutcomeRegistered;
}): Promise<void> {
  await rewriteRoomNotices({
    channelId: input.channelId,
    needle: input.minutesId,
    // LIKE 는 후보만 좁힌다 — 다른 회의 id 의 부분 문자열일 수 있으니 정확히 맞춘다.
    update: (notice) =>
      notice.kind === "meeting_outcome" && notice.minutesId === input.minutesId
        ? {
            ...notice,
            resolved: {
              boardSlug: input.registered.boardSlug,
              tenant: input.registered.tenant,
              taskCount: input.registered.taskIds.length,
              by: input.registered.by,
              at: input.registered.at,
            },
          }
        : null,
  });
}
