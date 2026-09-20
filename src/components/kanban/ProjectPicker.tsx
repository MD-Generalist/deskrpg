"use client";

/**
 * 헤더의 프로젝트(= 보드) 선택기.
 *
 * 채널에 보드가 하나뿐이면 **아무것도 그리지 않는다** — 고를 것이 없는데 선택기를 두면 화면만
 * 복잡해진다. 둘 이상일 때만 나타난다.
 *
 * 고른 값은 사용자별 `localStorage` 에 남는다(결정 B-1). 서버에 두지 않는 이유는 같은 채널을
 * 보는 사람들이 서로 다른 프로젝트를 열어 둘 수 있어야 해서다. 기기를 바꾸면 기본 프로젝트로
 * 돌아간다 — 그 대가를 받아들인 선택이다.
 */

import { useCallback, useState } from "react";
import { FolderKanban } from "lucide-react";

import { useT } from "@/lib/i18n";

export type ProjectOption = {
  id: string;
  boardSlug: string;
  name: string | null;
  status: string;
  isEventCarrier: boolean;
  /**
   * `YYYY-MM-DD` 또는 null. 선택기는 쓰지 않지만 같은 응답에서 오고, 타임라인의 목표일 선이
   * 이 값을 읽는다. 서버(`ProjectView`)는 처음부터 보내고 있었다.
   */
  targetDate?: string | null;
};

const STORAGE_PREFIX = "deskrpg:kanban:board:";

/** 브라우저 저장소는 사생활 모드·차단 설정에서 던진다. 못 읽어도 화면은 서야 한다. */
function readStored(channelId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + channelId);
  } catch {
    return null;
  }
}

function writeStored(channelId: string, boardSlug: string | null) {
  try {
    if (boardSlug === null) window.localStorage.removeItem(STORAGE_PREFIX + channelId);
    else window.localStorage.setItem(STORAGE_PREFIX + channelId, boardSlug);
  } catch {
    // 저장 못 해도 이번 세션 동안은 고른 대로 보인다.
  }
}

/**
 * 고른 보드를 돌려준다. 저장된 값이 지금 목록에 없으면(보드가 사라졌거나 다른 기기의 값)
 * 기본 보드로 떨어지고 저장된 값을 지운다 — 없는 보드를 계속 요청하면 404 만 돈다.
 */
export function useSelectedBoard(channelId: string, options: ProjectOption[]) {
  // 저장소는 첫 렌더에서 한 번만 읽는다. 목록이 아직 비어 있어도 고른 값은 살아 있어야 한다 —
  // 그래야 모달을 다시 열 때 전에 보던 프로젝트가 잠깐 기본 보드로 깜빡이지 않는다.
  const [stored, setStored] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStored(channelId),
  );
  const [channel, setChannel] = useState(channelId);
  if (channel !== channelId) {
    // 채널이 바뀌면 그 채널의 값으로 갈아탄다(렌더 중 상태 교체 — 효과보다 한 박자 빠르다).
    setChannel(channelId);
    setStored(typeof window === "undefined" ? null : readStored(channelId));
  }

  // 저장된 값이 지금 목록에 없으면(보드가 사라졌거나 다른 기기의 값) **파생 단계에서** 기본
  // 보드로 떨어뜨린다 — 없는 보드를 계속 요청하면 404 만 돈다.
  //
  // 저장소를 지우지는 않는다. 목록이 잠깐 비는 경우(조회 실패)에 사용자의 선택을 영구 삭제하지
  // 않기 위해서다 — 그 보드가 다시 목록에 나타나면 선택도 그대로 살아난다. 진짜로 사라진
  // 보드의 값은 다음 선택이 덮어쓴다.
  const known = options.length === 0 || options.some((o) => o.boardSlug === stored);

  const select = useCallback(
    (boardSlug: string | null) => {
      setStored(boardSlug);
      writeStored(channelId, boardSlug);
    },
    [channelId],
  );

  return { selected: known ? stored : null, select };
}

export function ProjectPicker({
  options,
  selected,
  onSelect,
}: {
  options: ProjectOption[];
  /** null 이면 기본(사건 수신) 보드 */
  selected: string | null;
  onSelect(boardSlug: string | null): void;
}) {
  const t = useT();
  if (options.length < 2) return null;

  const fallback = options.find((o) => o.isEventCarrier) ?? options[0];
  const value = selected ?? fallback.boardSlug;

  return (
    <label className="flex items-center gap-1 text-xs text-text-secondary">
      <FolderKanban className="w-3.5 h-3.5" aria-hidden />
      <span className="sr-only">{t("kanban.project.pick")}</span>
      <select
        data-project-picker
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onSelect(next === fallback.boardSlug ? null : next);
        }}
        className="bg-surface-raised text-text-primary rounded-md px-2 py-1 max-w-[180px] truncate"
      >
        {options.map((option) => (
          <option key={option.boardSlug} value={option.boardSlug}>
            {option.name ?? option.boardSlug}
          </option>
        ))}
      </select>
    </label>
  );
}
