"use client";

import { useEffect } from "react";

/**
 * 맨 위 레이어인 이 창이 Esc 를 받아 닫고, preventDefault 로 소비한다.
 * 아래 레이어(대화창 등)는 defaultPrevented 인 Esc 를 무시한다. 이미 소비된 Esc 는 여기서도 무시한다.
 */
export function useEscapeClose(onEscape: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onEscape]);
}
