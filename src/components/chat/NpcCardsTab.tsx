"use client";
/**
 * 직원 대화창의 "카드" 탭 — 이 NPC 가 담당인 칸반 카드 목록. 크론 탭(`CronPanel`)의 짜임새를
 * 따른다.
 *
 * **스스로 조회하지 않는다.** `board`(또는 `error`)를 부모(`ChatPanel`, Task 6)가 넘겨주고,
 * 여기는 `assignedCards` 로 고른 결과를 그리기만 한다 — DB·네트워크 없이 테스트되고 클라이언트
 * 번들 경계를 넘지 않는다.
 *
 * **빈 상태와 오류를 구분한다.** 게이트에 막힌 것(플러그인 없음·업그레이드 필요·게이트웨이
 * 미연결 등)을 "담당 카드 없음" 으로 보이면 사용자가 원인을 알 수 없다. 오류 문구는 크론·칸반이
 * 이미 쓰는 `@/lib/gate-failure` 분류와 `wizard-error-codes` 메시지를 그대로 재사용한다.
 */
import { useMemo } from "react";

import { useT } from "@/lib/i18n";
import type { KanbanBoard } from "@/lib/hermes/deskrpg-plugin-types";
import { classifyGateFailure } from "@/lib/gate-failure";
import { getWizardErrorMessage } from "@/components/hermes/wizard-error-codes";
import { assignedCards } from "@/components/kanban/npc-assigned-cards";

export interface NpcCardsTabProps {
  channelId: string;
  npcId: string;
  /** 담당자 판정 기준 — Hermes 프로필 이름(`KanbanTask.assignee`). */
  npcProfile: string;
  /** 이미 조회된 보드. 조회가 아직 안 끝났으면 `null`. */
  board: KanbanBoard | null;
  /** 보드를 못 가져온 이유(플러그인 게이트 코드 등). 있으면 `board` 보다 우선해 오류를 그린다. */
  error?: string | null;
  onOpenCard: (taskId: string) => void;
}

export default function NpcCardsTab({
  npcProfile,
  board,
  error = null,
  onOpenCard,
}: NpcCardsTabProps) {
  const t = useT();
  const cards = useMemo(() => (board ? assignedCards(board, npcProfile) : []), [board, npcProfile]);

  return (
    <div data-testid="npc-cards-tab" className="flex flex-col min-h-0 h-full bg-bg text-text">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {error !== null ? (
          <CardsErrorNotice code={error} />
        ) : cards.length === 0 ? (
          <p data-testid="cards-empty" className="text-sm text-text-dim py-4 text-center">
            {t("cards.empty")}
          </p>
        ) : (
          <ul role="list" className="space-y-1">
            {cards.map((card) => (
              <li key={card.id} role="listitem">
                <button
                  type="button"
                  data-card-id={card.id}
                  onClick={() => onOpenCard(card.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border bg-surface border-border hover:bg-surface-raised"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate flex-1">{card.title}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    {t(`kanban.column.${card.status}`)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 428/409/503 게이트 안내 — `CronErrorNotice`(`cron-notices.tsx`)와 같은 키를 쓴다. */
function CardsErrorNotice({ code }: { code: string }) {
  const t = useT();
  const blocker = classifyGateFailure({ status: 0, code, message: code });

  if (blocker.kind === "gateway_not_bound") {
    return (
      <div
        role="alert"
        data-testid="cards-error"
        className="p-3 rounded border border-border bg-surface text-xs text-text"
      >
        {t("cron.error.gatewayNotBound")}
      </div>
    );
  }

  if (blocker.kind === "plugin_upgrade_required") {
    return (
      <div
        role="alert"
        data-testid="cards-error"
        className="p-3 rounded border border-amber-600/60 bg-amber-900/20 text-xs text-text space-y-1.5"
      >
        <p className="font-semibold">
          {t("cron.error.upgradeRequired", { minVersion: blocker.minVersion })}
        </p>
        <p className="text-text-muted">{t("cron.error.upgradeHint")}</p>
        <code className="block px-2 py-1.5 bg-bg border border-border rounded font-mono text-[11px] break-all select-all">
          {blocker.command}
        </code>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="cards-error"
      className="p-3 rounded border border-red-700/60 bg-red-900/20 text-xs text-text space-y-1"
    >
      <p>{getWizardErrorMessage(t, code)}</p>
      <p className="font-mono text-[11px] text-text-muted break-all">{code}</p>
    </div>
  );
}
