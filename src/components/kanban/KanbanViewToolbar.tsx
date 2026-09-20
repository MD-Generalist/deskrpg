"use client";

import { Archive, GanttChartSquare, LayoutGrid, List } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { GroupBy, ProjectViewState, SortField } from "@/lib/kanban-view-state";

const GROUP_OPTIONS: GroupBy[] = ["status", "tenant", "assignee", "priority", "none"];
const SORT_OPTIONS: SortField[] = ["created", "started", "priority", "title", "status"];

export interface KanbanViewToolbarProps {
  state: ProjectViewState;
  tenants: readonly string[];
  assignees: readonly string[];
  onUpdate: (patch: Partial<ProjectViewState>) => void;
  onFilter: (patch: Partial<ProjectViewState["filter"]>) => void;
  /**
   * 플러그인에 `kanban_views` 가 있는가. 없으면 타임라인 버튼을 아예 두지 않는다 —
   * 눌러도 안 되는 버튼은 고장으로 읽힌다.
   */
  timelineSupported: boolean;
}

/**
 * 보기 방식·묶기·정렬·필터.
 *
 * 보관함 토글이 여기 있다 — 예전에는 헤더에 따로 있었는데, 같은 뜻의 스위치가 두 곳에 있으면
 * 어느 쪽이 참인지 알 수 없다. 좁은 화면에서는 컨트롤이 줄바꿈으로 흐른다.
 */
export default function KanbanViewToolbar({
  state,
  tenants,
  assignees,
  onUpdate,
  onFilter,
  timelineSupported,
}: KanbanViewToolbarProps) {
  const t = useT();
  const activeFilters =
    state.filter.tenants.length +
    state.filter.assignees.length +
    (state.filter.warningsOnly ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs">
      <div
        className="flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={t("kanban.view.switchLabel")}
      >
        <ModeButton
          active={state.viewMode === "board"}
          label={t("kanban.view.board")}
          onClick={() => onUpdate({ viewMode: "board" })}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
        />
        <ModeButton
          active={state.viewMode === "list"}
          label={t("kanban.view.list")}
          onClick={() => onUpdate({ viewMode: "list" })}
          icon={<List className="h-3.5 w-3.5" />}
        />
        {timelineSupported && (
          <ModeButton
            active={state.viewMode === "timeline"}
            label={t("kanban.view.timeline")}
            onClick={() => onUpdate({ viewMode: "timeline" })}
            icon={<GanttChartSquare className="h-3.5 w-3.5" />}
            hint={t("kanban.view.timeline.hint")}
          />
        )}
      </div>

      {state.viewMode === "list" && (
        <>
          <Select
            label={t("kanban.view.groupBy")}
            value={state.groupBy}
            onChange={(v) => onUpdate({ groupBy: v as GroupBy })}
            options={GROUP_OPTIONS.map((g) => ({
              value: g,
              label: t(`kanban.view.groupBy.${g}`),
            }))}
          />
          <Select
            label={t("kanban.view.sortBy")}
            value={state.sortField}
            onChange={(v) => onUpdate({ sortField: v as SortField })}
            options={SORT_OPTIONS.map((s) => ({
              value: s,
              label: t(`kanban.view.sort.${s}`),
            }))}
          />
          <button
            type="button"
            onClick={() => onUpdate({ sortDir: state.sortDir === "asc" ? "desc" : "asc" })}
            className="rounded-md bg-surface-raised px-2 py-1 text-text-secondary hover:brightness-125"
          >
            {state.sortDir === "asc" ? t("kanban.view.sortAsc") : t("kanban.view.sortDesc")}
          </button>
        </>
      )}

      {tenants.length > 0 && (
        <Select
          label={t("kanban.view.filterTenant")}
          value={state.filter.tenants[0] ?? ""}
          onChange={(v) => onFilter({ tenants: v ? [v] : [] })}
          options={[
            { value: "", label: t("kanban.view.groupBy.none") },
            ...tenants.map((name) => ({ value: name, label: name })),
          ]}
        />
      )}

      {assignees.length > 0 && (
        <Select
          label={t("kanban.view.filterAssignee")}
          value={state.filter.assignees[0] ?? ""}
          onChange={(v) => onFilter({ assignees: v ? [v] : [] })}
          options={[
            { value: "", label: t("kanban.view.groupBy.none") },
            ...assignees.map((name) => ({ value: name, label: name })),
          ]}
        />
      )}

      <label className="flex cursor-pointer items-center gap-1 rounded-md bg-surface-raised px-2 py-1 text-text-secondary">
        <input
          type="checkbox"
          checked={state.filter.warningsOnly}
          onChange={(e) => onFilter({ warningsOnly: e.target.checked })}
        />
        {t("kanban.view.warningsOnly")}
      </label>

      <label className="flex cursor-pointer items-center gap-1 rounded-md bg-surface-raised px-2 py-1 text-text-secondary">
        <input
          type="checkbox"
          data-kanban-archive-toggle
          checked={state.filter.includeArchived}
          onChange={(e) => onFilter({ includeArchived: e.target.checked })}
        />
        <Archive className="h-3.5 w-3.5" />
        {t("kanban.includeArchived")}
      </label>

      {activeFilters > 0 && (
        <button
          type="button"
          onClick={() => onFilter({ tenants: [], assignees: [], warningsOnly: false })}
          className="rounded-md px-2 py-1 text-text-muted underline hover:text-text"
        >
          {t("kanban.view.clearFilters")}
        </button>
      )}
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
  icon,
  hint,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  /**
   * 더 긴 설명. `title` 로만 쓰고 `aria-label` 은 짧은 이름을 유지한다 — 보조 기술이 읽는
   * 이름은 화면에 보이는 글자와 같아야 한다. 간트를 찾는 사람이 이 설명에서 멈추게 하는 용도다.
   */
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={hint ?? label}
      className={`flex items-center gap-1 px-2 py-1 ${
        active ? "bg-primary text-white" : "bg-surface-raised text-text-secondary"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1 text-text-muted">
      <span className="hidden md:inline">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-text"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
