/**
 * 조작 직후 즉시 폴링(R24)의 **fire-and-forget** 한 겹.
 *
 * 칸반·크론 라우트는 변경이 성공한 뒤 `schedulePollNow(channelId)` 를 부르고 응답으로
 * 돌아간다 — 폴링을 기다리지 않고, 폴링의 실패는 응답에 섞이지 않는다(폴러가 `last_error`
 * 에 남긴다). 폴러가 아직 없으면(테스트·CLI 초기) `pollNow` 가 null 을 돌려주고 끝난다.
 *
 * 테스트는 `setPollNowForTests` 로 실제 폴러 대신 기록기를 꽂는다 — 라우트가 "언제"
 * 폴링을 요청하는지가 검증 대상이고, 폴링 자체는 `automation-poller.test.ts` 의 몫이다.
 */

import { pollNow as livePollNow } from "@/server/automation-poller";

type PollNowFn = typeof livePollNow;

let pollNowImpl: PollNowFn = livePollNow;

export function schedulePollNow(channelId: string): void {
  try {
    void pollNowImpl(channelId).catch((err: unknown) => {
      console.warn(
        `[automation-poll-trigger] pollNow(${channelId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  } catch (err) {
    console.warn(
      `[automation-poll-trigger] pollNow(${channelId}) threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 테스트 전용 — null 을 주면 실제 폴러로 되돌린다. */
export function setPollNowForTests(fn: PollNowFn | null): void {
  pollNowImpl = fn ?? livePollNow;
}
