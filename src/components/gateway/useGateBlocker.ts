"use client";

import { useCallback, useState } from "react";

import { classifyGateFailure, type GateBlocker, type GateFailure } from "@/lib/gate-failure";

/**
 * 게이트 실패 하나를 화면 상태로 들고 있는다. 호출부가 흩어진 칸반·아티팩트용이다 —
 * 크론은 `cron-api.ts` 한 통로에서 잡으므로 이 훅을 쓰지 않는다.
 */
export function useGateBlocker() {
  const [blocker, setBlocker] = useState<GateBlocker | null>(null);

  const show = useCallback((failure: GateFailure) => {
    setBlocker(classifyGateFailure(failure));
  }, []);

  /** status·code 를 가진 오류 객체를 그대로 받는다. 모양이 다르면 `other` 로 떨어진다. */
  const showFromError = useCallback((err: unknown) => {
    const shape = err as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      minVersion?: unknown;
    };
    setBlocker(
      classifyGateFailure({
        status: typeof shape?.status === "number" ? shape.status : 0,
        code: typeof shape?.code === "string" ? shape.code : "unknown",
        message: typeof shape?.message === "string" ? shape.message : "",
        minVersion: typeof shape?.minVersion === "string" ? shape.minVersion : undefined,
      }),
    );
  }, []);

  const clear = useCallback(() => setBlocker(null), []);

  return { blocker, show, showFromError, clear };
}
