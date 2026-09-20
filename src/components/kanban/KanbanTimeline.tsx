"use client";

import { useMemo } from "react";

import { useLocale, useT } from "@/lib/i18n";
import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import {
  axisTicks,
  barDurationMs,
  layoutTimeline,
  type PositionedBar,
  type RunTone,
  type TimelineWindow,
  type WindowPreset,
} from "@/lib/timeline-layout";

import { formatElapsed } from "./kanban-view-model";

/**
 * 실적 타임라인 — "누가 언제 실제로 일했는가".
 *
 * 계획이 아니라 실적이다. 행은 카드가 아니라 작업자이고 막대 하나가 실행 기록 한 건이다.
 * 라이브러리 없이 인라인 SVG 로 그린다.
 *
 * **표 대체본을 반드시 함께 낸다.** SVG 는 스크린리더에 통째로 안 읽히고 키보드로 훑을 수도
 * 없다. 같은 사실에 다른 길로 닿게 하는 것은 선택이 아니다.
 *
 * 줌·미니맵·위임 커넥터는 넣지 않는다. 고정 창(오늘/이번 주)과 호버 설명까지다 — 요구가
 * 생기면 그때 붙인다.
 */

const ROW_LABEL_WIDTH = 96;
const LANE_HEIGHT = 14;
const LANE_GAP = 2;
const ROW_GAP = 8;
const AXIS_HEIGHT = 18;
const PLOT_WIDTH = 1000; // viewBox 좌표. 실제 폭은 CSS 가 정한다.

const TONE_CLASS: Record<RunTone, string> = {
  running: "fill-primary",
  done: "fill-success",
  failed: "fill-danger",
  gaveUp: "fill-meeting",
  interrupted: "fill-info",
  other: "fill-text-muted",
};

export interface KanbanTimelineProps {
  runs: readonly KanbanTimelineRun[];
  window: TimelineWindow;
  preset: WindowPreset;
  onPresetChange: (preset: WindowPreset) => void;
  now: number;
  /** 플러그인이 상한에서 잘라 보냈는가. 잘린 창을 그대로 그리면 사실을 숨긴다. */
  truncated: boolean;
  loading: boolean;
  /** 조회 실패 메시지. 있으면 그림 대신 이것을 보인다. */
  error: string | null;
  onOpenTask: (taskId: string) => void;
}

export default function KanbanTimeline({
  runs,
  window: win,
  preset,
  onPresetChange,
  now,
  truncated,
  loading,
  error,
  onOpenTask,
}: KanbanTimelineProps) {
  const t = useT();
  const { locale } = useLocale();
  const layout = useMemo(() => layoutTimeline(runs, win, now), [runs, win, now]);
  const ticks = useMemo(() => axisTicks(win), [win]);

  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const stamp = (ms: number) => new Date(ms).toLocaleString(locale);

  const rowTops: number[] = [];
  let height = AXIS_HEIGHT;
  for (const row of layout.rows) {
    rowTops.push(height);
    height += row.lanes * LANE_HEIGHT + (row.lanes - 1) * LANE_GAP + ROW_GAP;
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto p-2 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <div
          className="flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label={t("kanban.timeline.range")}
        >
          {(["today", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onPresetChange(option)}
              aria-pressed={preset === option}
              className={`px-2 py-1 ${
                preset === option
                  ? "bg-primary text-white"
                  : "bg-surface-raised text-text-secondary"
              }`}
            >
              {t(`kanban.timeline.range.${option}`)}
            </button>
          ))}
        </div>
        <span className="text-text-muted">
          {stamp(win.fromMs)} — {stamp(win.toMs)}
        </span>
        {loading && <span className="text-text-dim">{t("common.loading")}</span>}
      </div>

      {truncated && (
        <p className="mb-2 rounded-md bg-surface-raised px-2 py-1 text-[11px] text-text-secondary">
          {t("kanban.timeline.truncated")}
        </p>
      )}
      {layout.omitted > 0 && (
        <p className="mb-2 text-[11px] text-text-muted">
          {t("kanban.timeline.omitted", { count: layout.omitted })}
        </p>
      )}

      {error ? (
        <p className="p-4 text-sm text-danger">{error}</p>
      ) : layout.rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-muted">{t("kanban.timeline.empty")}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${ROW_LABEL_WIDTH + PLOT_WIDTH} ${height}`}
            className="w-full"
            style={{ minHeight: height }}
            role="presentation"
          >
            {ticks.map((tick) => {
              const x =
                ROW_LABEL_WIDTH + ((tick - win.fromMs) / (win.toMs - win.fromMs)) * PLOT_WIDTH;
              return (
                <g key={tick}>
                  <line
                    x1={x}
                    y1={AXIS_HEIGHT - 4}
                    x2={x}
                    y2={height}
                    className="stroke-border-subtle"
                    strokeWidth={1}
                  />
                  <text x={x + 2} y={10} className="fill-text-dim" fontSize={9}>
                    {clock(tick)}
                  </text>
                </g>
              );
            })}

            {layout.rows.map((row, rowIndex) => (
              <g key={row.profile ?? "__unknown__"}>
                <text
                  x={0}
                  y={rowTops[rowIndex] + LANE_HEIGHT - 3}
                  className="fill-text-secondary"
                  fontSize={10}
                >
                  {row.profile ?? t("kanban.timeline.unknownActor")}
                </text>
                {row.bars.map((bar) => (
                  <Bar
                    key={bar.run.id}
                    bar={bar}
                    top={rowTops[rowIndex] + bar.lane * (LANE_HEIGHT + LANE_GAP)}
                    title={barTitle(bar, { t, stamp })}
                    onOpen={() => onOpenTask(bar.run.task_id)}
                  />
                ))}
              </g>
            ))}
          </svg>

          {/*
            표 대체본. SVG 는 스크린리더에 통째로 안 읽히고 키보드로 훑을 수도 없다.
            같은 데이터를 같은 순서로 낸다 — 요약이 아니라 대체본이다.
          */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-text-secondary">
              {t("kanban.timeline.tableToggle")}
            </summary>
            <table className="mt-2 w-full text-left text-[11px]">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-2">
                    {t("kanban.timeline.col.actor")}
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    {t("kanban.timeline.col.task")}
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    {t("kanban.timeline.col.start")}
                  </th>
                  <th scope="col" className="py-1 pr-2">
                    {t("kanban.timeline.col.duration")}
                  </th>
                  <th scope="col" className="py-1">
                    {t("kanban.timeline.col.outcome")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {layout.rows.flatMap((row) =>
                  row.bars.map((bar) => (
                    <tr key={bar.run.id} className="border-t border-border-subtle">
                      <td className="py-1 pr-2 text-text-secondary">
                        {row.profile ?? t("kanban.timeline.unknownActor")}
                      </td>
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          onClick={() => onOpenTask(bar.run.task_id)}
                          className="text-text underline"
                        >
                          {bar.run.task_title ?? bar.run.task_id}
                        </button>
                      </td>
                      <td className="py-1 pr-2 text-text-muted">{stamp(bar.startMs)}</td>
                      <td className="py-1 pr-2 text-text-muted">
                        {formatElapsed(Math.round(barDurationMs(bar) / 1000))}
                        {bar.open ? ` (${t("kanban.timeline.stillRunning")})` : ""}
                      </td>
                      <td className="py-1 text-text-muted">
                        {bar.run.outcome ?? t(`kanban.timeline.tone.${bar.tone}`)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

function Bar({
  bar,
  top,
  title,
  onOpen,
}: {
  bar: PositionedBar;
  top: number;
  title: string;
  onOpen: () => void;
}) {
  // 폭이 0에 가까운 실행도 보여야 한다 — 1초짜리 실패가 눈에 안 보이면 없는 것과 같다.
  const width = Math.max(bar.width * PLOT_WIDTH, 2);
  return (
    <g onClick={onOpen} className="cursor-pointer">
      <title>{title}</title>
      <rect
        x={ROW_LABEL_WIDTH + bar.x * PLOT_WIDTH}
        y={top}
        width={width}
        height={LANE_HEIGHT - 2}
        rx={2}
        className={TONE_CLASS[bar.tone]}
        opacity={bar.open ? 0.55 : 1}
      />
    </g>
  );
}

function barTitle(
  bar: PositionedBar,
  fmt: {
    t: (key: string, params?: Record<string, string | number>) => string;
    stamp: (ms: number) => string;
  },
): string {
  const parts = [
    bar.run.task_title ?? bar.run.task_id,
    bar.run.profile ?? fmt.t("kanban.timeline.unknownActor"),
    `${fmt.stamp(bar.startMs)} → ${bar.open ? fmt.t("kanban.timeline.stillRunning") : fmt.stamp(bar.endMs)}`,
    formatElapsed(Math.round(barDurationMs(bar) / 1000)),
  ];
  if (bar.run.outcome) parts.push(bar.run.outcome);
  if (bar.run.tenant) parts.push(bar.run.tenant);
  return parts.join(" · ");
}
