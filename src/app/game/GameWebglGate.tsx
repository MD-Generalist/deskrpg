"use client";

import { useT } from "@/lib/i18n";

import GamePageClient from "./GamePageClient";
import { WebglGate } from "./webgl-gate";

/** 게임 페이지의 배선 — 관문을 통과한 뒤에만 채널 화면이 마운트된다. */
export default function GameWebglGate() {
  const t = useT();

  return (
    <WebglGate
      renderWorkspace={(onFatal) => <GamePageClient onFatal={onFatal} />}
      renderChecking={() => (
        <div className="min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      )}
    />
  );
}
