"use client";

import { UserPlus } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { CharacterAppearance, LegacyCharacterAppearance } from "@/lib/lpc-registry";
import RosterAvatar from "./RosterAvatar";

/**
 * NPC 출근부.
 *
 * NPC 는 더 이상 사용자가 "고용" 하는 것이 아니라 **게이트웨이 프로필이 채널에 갖는
 * 자리** 다. 그래서 이 목록은 맵에 서 있는 NPC 만이 아니라 세 상태를 모두 보여준다 —
 * 자리 있음(출근·배치됨) · 자리 미정(출근했지만 아직 맵에 자리가 없음) · 쉬는 중(퇴근).
 * "자리 미정" 은 버튼이다: 누르면 맵 배치 모드로 들어간다.
 */
export type RosterNpc = {
  id: string;
  name: string;
  appearance?: unknown;
  active: boolean;
  placed: boolean;
  profile?: { ownerUserId?: string } | null;
};

export type NpcRosterProps = {
  npcs: RosterNpc[];
  /** 진행 중인 토론에 앉아 있는 NPC — 퇴근시키면 턴이 갈 곳을 잃는다. */
  meetingNpcIds: Set<string>;
  isOwner: boolean;
  currentUserId: string;
  onToggle: (npcId: string, active: boolean) => void;
  onPlace: (npcId: string) => void;
  onHire: () => void;
  /** 채널에 게이트웨이가 없으면 새 직원을 만들 곳이 없다. */
  hireDisabled?: boolean;
  /** 행을 눌렀을 때 여는 동작 메뉴(대화·호출 등). 없으면 행은 버튼이 아니다. */
  onOpenMenu?: (anchor: HTMLElement, npc: RosterNpc) => void;
};

export default function NpcRoster({
  npcs,
  meetingNpcIds,
  isOwner,
  currentUserId,
  onToggle,
  onPlace,
  onHire,
  hireDisabled = false,
  onOpenMenu,
}: NpcRosterProps) {
  const t = useT();

  return (
    <div>
      <div className="px-3 py-2 border-b border-border text-caption text-text-dim flex items-center justify-between gap-2">
        <span>{t("game.roster.title")}</span>
        {isOwner && (
          <button
            onClick={onHire}
            disabled={hireDisabled}
            title={hireDisabled ? t("game.roster.needsGateway") : undefined}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/80 hover:bg-primary text-white text-micro font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserPlus className="w-3 h-3" />
            <span>{t("game.roster.hire")}</span>
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {npcs.length === 0 ? (
          <div className="px-3 py-3 text-caption text-text-dim">{t("game.noNpcsAtWork")}</div>
        ) : (
          npcs.map((npc) => {
            const inMeeting = meetingNpcIds.has(npc.id);
            // 내가 누구인지 모르면(빈 문자열) 아무 주장도 하지 않는다 — 모르는 채로
            // 비교하면 전부 "공유됨" 이 된다.
            const shared =
              !!currentUserId &&
              !!npc.profile?.ownerUserId &&
              npc.profile.ownerUserId !== currentUserId;
            return (
              <div
                key={npc.id}
                className="px-3 py-2 flex items-center gap-2 text-body text-text-secondary"
              >
                <RosterAvatar
                  appearance={
                    (npc.appearance ?? null) as
                      CharacterAppearance | LegacyCharacterAppearance | null
                  }
                />
                {onOpenMenu ? (
                  <button
                    onClick={(event) => onOpenMenu(event.currentTarget, npc)}
                    className="truncate text-left hover:underline"
                  >
                    {npc.name}
                  </button>
                ) : (
                  <span className="truncate">{npc.name}</span>
                )}
                {shared && (
                  <span className="text-micro text-text-dim shrink-0">
                    {t("game.roster.shared")}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {!npc.active ? (
                    <span className="text-micro text-text-dim">{t("game.roster.dormant")}</span>
                  ) : npc.placed ? (
                    <span className="text-micro text-text-dim">{t("game.roster.placed")}</span>
                  ) : (
                    <button
                      onClick={() => onPlace(npc.id)}
                      className="text-micro px-2 py-0.5 rounded bg-surface-raised hover:brightness-125 text-primary-light"
                    >
                      {t("game.roster.unplaced")}
                    </button>
                  )}
                  {isOwner && (
                    <button
                      data-testid={`toggle-${npc.id}`}
                      onClick={() => onToggle(npc.id, !npc.active)}
                      disabled={inMeeting}
                      title={inMeeting ? t("game.roster.inMeeting") : undefined}
                      className="text-micro px-2 py-0.5 rounded bg-surface-raised hover:brightness-125 text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {npc.active ? t("npc.sleep") : t("npc.wake")}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
