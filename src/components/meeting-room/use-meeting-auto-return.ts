"use client";

/**
 * 회의가 끝난 뒤 오피스로 자동 복귀.
 *
 * 회의 화면에 있는 동안은 보고 호출이 막힌다(`reportCallBlocked` 의 `inMeeting`). 후속 업무를
 * 등록했거나 등록하지 않기로 했으면 이 화면에서 더 할 일이 없으니, 몇 초 알린 뒤 맵 우상단
 * "오피스로" 와 같은 `meeting:exit-intent` 로 나간다. 후속 업무가 없는 회의는 요약을 읽을
 * 시간을 주기 위해 나가지 않고 안내만 한다. 회의록은 보관함에서 다시 열 수 있다.
 *
 * `active` 는 "종료 화면이 떠 있다" 이다. 꺼지면(새 회의 시작 등) 세던 것을 버린다 —
 * 회의 진행 중에는 절대 나가지 않는다.
 */
import { useCallback, useEffect, useState } from "react";

import { EventBus } from "@/game/EventBus";

export const AUTO_RETURN_SECONDS = 5;

export type AutoReturnState =
  | { status: "idle" }
  | { status: "counting"; remaining: number }
  | { status: "stayed" }
  | { status: "hint" }
  | { status: "returned" };

export function useMeetingAutoReturn(active: boolean, seconds = AUTO_RETURN_SECONDS) {
  const [state, setState] = useState<AutoReturnState>({ status: "idle" });
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setState({ status: "idle" });
  }

  useEffect(() => {
    if (!active || state.status !== "counting") return;
    const timer = setTimeout(() => {
      if (state.remaining > 1) {
        setState({ status: "counting", remaining: state.remaining - 1 });
        return;
      }
      setState({ status: "returned" });
      EventBus.emit("meeting:exit-intent");
    }, 1000);
    return () => clearTimeout(timer);
  }, [active, state]);

  /** 등록을 마쳤거나 등록하지 않기로 했다. */
  const start = useCallback(() => {
    if (active) setState({ status: "counting", remaining: seconds });
  }, [active, seconds]);
  const stay = useCallback(() => setState({ status: "stayed" }), []);
  /** 자동으로 나가지 않을 회의 — 나가면 보고가 온다는 것만 알린다. 세는 중이면 건드리지 않는다. */
  const hint = useCallback(() => {
    if (active) setState((prev) => (prev.status === "idle" ? { status: "hint" } : prev));
  }, [active]);

  return { state, start, stay, hint };
}
