/**
 * 조작 직후 즉시 폴링(R24)의 **fire-and-forget** 한 겹.
 *
 * 칸반·크론 라우트는 변경이 성공한 뒤 `schedulePollNow(channelId)` 를 부르고 응답으로
 * 돌아간다 — 폴링을 기다리지 않고, 폴링의 실패는 응답에 섞이지 않는다(폴러가 `last_error`
 * 에 남긴다). 폴러가 아직 없으면(테스트·CLI 초기) 레지스트리가 null 을 돌려주고 끝난다.
 *
 * 실제 폴러는 `@/server/*` 를 직접 import 하지 않고 `automation-registry.ts` 를 통해 만난다 —
 * 소켓 서버 모듈이 Next 번들로 끌려오면 빌드가 깨진다(`app-server-boundary.test.ts`).
 *
 * 테스트는 `setPollNowForTests` 로 실제 폴러 대신 기록기를 꽂는다 — 라우트가 "언제"
 * 폴링을 요청하는지가 검증 대상이고, 폴링 자체는 `automation-poller.test.ts` 의 몫이다.
 */

import { requestPollNow } from "@/lib/automation-registry";

type PollNowFn = (channelId: string) => Promise<unknown>;

let pollNowImpl: PollNowFn = requestPollNow;

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

/** 테스트 전용 — null 을 주면 레지스트리 경유(실제 폴러)로 되돌린다. */
export function setPollNowForTests(fn: PollNowFn | null): void {
  pollNowImpl = fn ?? requestPollNow;
}
