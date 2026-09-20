"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";
import {
  applyFilter,
  DEFAULT_VIEW_STATE,
  groupTasks,
  normalizeViewState,
  sortTasks,
  type ProjectViewState,
  type TaskGroup,
} from "@/lib/kanban-view-state";

const STORAGE_PREFIX = "deskrpg.kanban.view.";

/**
 * 뷰 상태를 들고, 카드 목록을 그 상태대로 접어 준다.
 *
 * 저장은 채널별 `localStorage` 다 — 보는 방식은 그 사람의 취향이지 서버의 사실이 아니다.
 * 읽기는 언제나 실패할 수 있다고 보고(사생활 보호 창·차단된 저장소) 기본값으로 떨어진다.
 */
export function useProjectViewState(channelId: string) {
  const [state, setState] = useState<ProjectViewState>(DEFAULT_VIEW_STATE);

  // 채널이 바뀌면 그 채널의 저장값을 읽는다. 첫 렌더에서 읽지 않는 것은 서버 렌더와
  // 클라이언트 렌더가 어긋나지 않게 하기 위해서다.
  useEffect(() => {
    setState(readStored(channelId));
  }, [channelId]);

  const update = useCallback(
    (patch: Partial<ProjectViewState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        writeStored(channelId, next);
        return next;
      });
    },
    [channelId],
  );

  const setFilter = useCallback(
    (patch: Partial<ProjectViewState["filter"]>) => {
      setState((prev) => {
        const next = { ...prev, filter: { ...prev.filter, ...patch } };
        writeStored(channelId, next);
        return next;
      });
    },
    [channelId],
  );

  const toggleGroup = useCallback(
    (key: string) => {
      setState((prev) => {
        const has = prev.collapsedGroups.includes(key);
        const next = {
          ...prev,
          collapsedGroups: has
            ? prev.collapsedGroups.filter((k) => k !== key)
            : [...prev.collapsedGroups, key],
        };
        writeStored(channelId, next);
        return next;
      });
    },
    [channelId],
  );

  return { state, update, setFilter, toggleGroup };
}

/**
 * 카드 목록을 뷰 상태대로 거르고·정렬하고·묶는다.
 *
 * 상태 훅과 나눈 이유는 순서다 — `includeArchived` 는 보드를 **조회하기 전에** 필요하고,
 * 묶기는 응답이 온 **뒤에야** 할 수 있다. 한 훅에 묶으면 보드 조회가 자기 결과를 기다리게 된다.
 */
export function useTaskGroups(
  tasks: readonly KanbanTask[],
  state: ProjectViewState,
  known: { tenants?: readonly string[]; assignees?: readonly string[] },
): TaskGroup[] {
  const { tenants, assignees } = known;
  return useMemo(() => {
    const filtered = applyFilter(tasks, state.filter);
    const sorted = sortTasks(filtered, state.sortField, state.sortDir);
    return groupTasks(sorted, state.groupBy, { tenants, assignees });
  }, [tasks, state.filter, state.sortField, state.sortDir, state.groupBy, tenants, assignees]);
}

function readStored(channelId: string): ProjectViewState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + channelId);
    return normalizeViewState(raw ? JSON.parse(raw) : null);
  } catch {
    // 저장소가 막혀 있거나 값이 깨졌다. 보는 방식일 뿐이므로 조용히 기본값으로 간다.
    return DEFAULT_VIEW_STATE;
  }
}

function writeStored(channelId: string, state: ProjectViewState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + channelId, JSON.stringify(state));
  } catch {
    // 저장에 실패해도 이번 세션의 화면은 그대로 동작한다.
  }
}
