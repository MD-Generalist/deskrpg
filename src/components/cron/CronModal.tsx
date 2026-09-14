"use client";
/**
 * 채널 크론 화면의 모달 셸(R15). `CronPanel` 은 내용만 그리므로 여기서 배경·대화상자·ESC 를
 * 붙인다 — `KanbanBoardModal` 과 같은 관례. 소켓 구독(`cron:event`)은 패널이 스스로 한다.
 */
import { useEffect } from "react";

import { useT } from "@/lib/i18n";

import CronPanel, { type CronEventSource, type CronPanelNpc } from "./CronPanel";

export interface CronModalProps {
  channelId: string;
  /** 채널의 active NPC — 이름은 프로필 표시명(`npcs.name` 이 아니다). */
  npcs: CronPanelNpc[];
  socket?: CronEventSource | null;
  onToast?: (message: string) => void;
  onClose: () => void;
  /** 방 알림의 "이력 열기" — 그 잡의 실행 이력으로 연다(R30). */
  initialJobId?: string | null;
}

export default function CronModal({
  channelId,
  npcs,
  socket = null,
  onToast,
  onClose,
  initialJobId = null,
}: CronModalProps) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="cron-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("cron.title")}
        className="bg-bg border border-border rounded-xl shadow-2xl w-[96vw] max-w-[1200px] h-[88dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CronPanel
          channelId={channelId}
          npcs={npcs}
          socket={socket}
          onToast={onToast}
          onClose={onClose}
          initialJobId={initialJobId}
          className="flex-1"
        />
      </div>
    </div>
  );
}
