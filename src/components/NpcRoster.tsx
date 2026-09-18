"use client";

import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { useT } from "@/lib/i18n";
import RosterAvatar from "./RosterAvatar";

/**
 * NPC 출근부.
 *
 * 출근한 직원은 항상 자리가 있다: 데스크 좌석이면 번호, 만석이라 서 있으면 "서 있음".
 * 둘 다 버튼이고 누르면 자리 변경 모드로 들어간다(소유자만).
 */
export type RosterNpc = {
  id: string;
  name: string;
  appearance?: unknown;
  active: boolean;
  placed: boolean;
  seatNumber?: number | null;
  profile?: { ownerUserId?: string; profileName?: string } | null;
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
  /** 있으면 헤더에 "여러 명 선택" 토글이 뜨고, 체크한 출근 NPC 로 그룹 대화를 시작한다. */
  onStartGroupChat?: (npcIds: string[]) => void;
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
  onStartGroupChat,
}: NpcRosterProps) {
  const t = useT();
  const seatLabel = (npc: RosterNpc) =>
    npc.seatNumber
      ? t("game.roster.seatNumber", { number: npc.seatNumber })
      : t("game.roster.standing");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelected = (npcId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(npcId)) next.delete(npcId);
      else next.add(npcId);
      return next;
    });
  };

  const startGroupChat = () => {
    if (!onStartGroupChat || selectedIds.size === 0) return;
    onStartGroupChat([...selectedIds]);
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  return (
    <div>
      <div className="px-3 py-2 border-b border-border text-caption text-text-dim flex items-center justify-between gap-2">
        <span>{t("game.roster.title")}</span>
        <div className="flex items-center gap-1">
          {onStartGroupChat && (
            <button
              onClick={toggleSelectMode}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-micro font-semibold ${
                selectMode
                  ? "bg-primary/80 hover:bg-primary text-white"
                  : "bg-surface-raised hover:brightness-125 text-text-secondary"
              }`}
            >
              <Users className="w-3 h-3" />
              <span>{t("game.roster.selectMode")}</span>
            </button>
          )}
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
                {selectMode && npc.active && (
                  <input
                    type="checkbox"
                    data-npc-id={npc.id}
                    checked={selectedIds.has(npc.id)}
                    onChange={() => toggleSelected(npc.id)}
                    className="shrink-0"
                  />
                )}
                <RosterAvatar appearance={npc.appearance ?? null} />
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
                  ) : isOwner ? (
                    <button
                      data-testid={`seat-${npc.id}`}
                      onClick={() => onPlace(npc.id)}
                      className="text-micro px-2 py-0.5 rounded bg-surface-raised hover:brightness-125 text-primary-light"
                    >
                      {seatLabel(npc)}
                    </button>
                  ) : (
                    <span className="text-micro text-text-dim">{seatLabel(npc)}</span>
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
      {selectMode && onStartGroupChat && (
        <div className="px-3 py-2 border-t border-border">
          <button
            onClick={startGroupChat}
            disabled={selectedIds.size === 0}
            className="w-full px-2 py-1.5 rounded-md bg-primary/80 hover:bg-primary text-white text-micro font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("game.roster.startGroupChat")}
          </button>
        </div>
      )}
    </div>
  );
}
