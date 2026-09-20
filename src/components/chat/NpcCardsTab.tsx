"use client";
/**
 * 직원 대화창의 "카드" 탭 — 이 NPC 가 담당인 칸반 카드 목록. 크론 탭(`CronPanel`)의 짜임새를
 * 따른다.
 *
 * **스스로 조회하지 않는다.** `board`(또는 `error`)를 부모(`ChatPanel`, Task 6)가 넘겨주고,
 * 여기는 `assignedCards` 로 고른 결과를 그리기만 한다 — DB·네트워크 없이 테스트되고 클라이언트
 * 번들 경계를 넘지 않는다.
 *
 * **확정되지 않은 상태를 빈 목록으로 단정하지 않는다.** 조회가 끝나기 전(`board`·`error` 가
 * 둘 다 `null`)에는 스켈레톤만 둔다. "담당 카드 없음" 은 **확정된 사실일 때만** 하는 말이다.
 * 보드가 도착했으면 로딩은 끝난 것이다 — `npcProfile` 을 몰라도 스켈레톤을 계속 돌리지 않는다.
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
import { assignedCards } from "@/lib/npc-assigned-cards";
import { failureLine } from "@/components/kanban/kanban-view-model";

export interface NpcCardsTabProps {
  /** 담당자 판정 기준 — Hermes 프로필 이름(`KanbanTask.assignee`). 모르면 빈 문자열. */
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
  // 프로필을 모르면 아예 고르지 않는다 — `assignee === ""` 인 카드가 "이 직원 담당" 으로
  // 잡히면 남의 카드를 보이게 된다. 담당은 프로필 이름으로만 붙으므로(`KanbanTask.assignee`),
  // 프로필이 없는 직원에게 붙은 카드도 없다 — 그래서 빈 목록은 추측이 아니라 사실이다.
  const cards = useMemo(
    () => (board && npcProfile ? assignedCards(board, npcProfile) : []),
    [board, npcProfile],
  );

  return (
    <div data-testid="npc-cards-tab" className="flex flex-col min-h-0 h-full bg-bg text-text">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {error !== null ? (
          <CardsErrorNotice code={error} />
        ) : board === null ? (
          <div data-testid="cards-loading" aria-busy="true" className="space-y-1 py-2">
            <div className="h-9 rounded-lg bg-surface" />
            <div className="h-9 rounded-lg bg-surface" />
          </div>
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

/**
 * 게이트 안내 — `classifyGateFailure` 가 내는 **모든** kind 에 전용 문구를 준다.
 *
 * 코드를 하나씩 때우면 같은 결함이 다음 코드에서 되살아난다(`board_unavailable` 하나만 고쳤다가
 * 더 흔한 `plugin_absent` 가 "알 수 없는 오류" 로 떨어졌다). 문구는 전부 재사용이다 — 칸반 보드의
 * 보드 미확보 줄(`failureLine`), 크론 탭의 게이트웨이·업그레이드 안내, 게이트 체크리스트의
 * 단계 문구. 새 i18n 키는 만들지 않는다.
 *
 * `classifyGateFailure` 와 `wizard-error-codes` 표는 건드리지 않는다 — 판정은 서버 하나이고
 * 그 표는 마법사 몫이다. 폴백은 남겨 둔다: 미래의 새 코드가 화면을 깨뜨리면 안 된다.
 */
function CardsErrorNotice({ code }: { code: string }) {
  const t = useT();

  // 503 보드 미준비(`kanban-access.ts`)는 `classifyGateFailure` 의 표에 없다 — 칸반 보드가
  // 이미 쓰는 문구를 그대로 재사용한다.
  if (code === "board_unavailable") {
    return (
      <Notice tone="neutral" title={t("kanban.blocker.boardTitle")}>
        <p className="text-text-muted break-words">{failureLine({ code, message: code })}</p>
      </Notice>
    );
  }

  const blocker = classifyGateFailure({ status: 0, code, message: code });

  switch (blocker.kind) {
    case "gateway_not_bound":
      return <Notice tone="neutral">{t("cron.error.gatewayNotBound")}</Notice>;
    case "plugin_absent":
      return (
        <Notice tone="warn" title={t("gateChecklist.step.plugin")}>
          <p className="text-text-muted">{t("gateChecklist.hint.plugin")}</p>
          <Command command={blocker.command} />
        </Notice>
      );
    case "plugin_unauthorized":
      return (
        <Notice tone="warn" title={t("gateChecklist.step.ownerKey")}>
          <p className="text-text-muted">{t("gateChecklist.hint.ownerKey")}</p>
        </Notice>
      );
    case "plugin_upgrade_required":
      return (
        <Notice
          tone="warn"
          title={t("cron.error.upgradeRequired", { minVersion: blocker.minVersion })}
        >
          <p className="text-text-muted">{t("cron.error.upgradeHint")}</p>
          <Command command={blocker.command} />
        </Notice>
      );
    // `plugin_unknown` 도 여기로 온다 — 사용자가 할 수 있는 일이 같다.
    case "unreachable":
      return <Notice tone="neutral">{t("gateChecklist.unreachable")}</Notice>;
    case "timeout":
      return <Notice tone="neutral">{t("gateChecklist.timeout")}</Notice>;
    default:
      return (
        <Notice tone="error">
          <p>{getWizardErrorMessage(t, code)}</p>
          <p className="font-mono text-[11px] text-text-muted break-all">{code}</p>
        </Notice>
      );
  }
}

/** 안내 상자 — 클래스는 리터럴로 둔다(동적 조립은 Tailwind 가 생성하지 않는다). */
function Notice({
  tone,
  title,
  children,
}: {
  tone: "neutral" | "warn" | "error";
  title?: string;
  children: React.ReactNode;
}) {
  const box =
    tone === "warn"
      ? "border-amber-600/60 bg-amber-900/20"
      : tone === "error"
        ? "border-red-700/60 bg-red-900/20"
        : "border-border bg-surface";
  return (
    <div
      role="alert"
      data-testid="cards-error"
      className={`p-3 rounded border text-xs text-text space-y-1.5 ${box}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  );
}

function Command({ command }: { command: string }) {
  return (
    <code className="block px-2 py-1.5 bg-bg border border-border rounded font-mono text-[11px] break-all select-all">
      {command}
    </code>
  );
}
