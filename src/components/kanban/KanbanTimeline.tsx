"use client";

import { useMemo } from "react";

import { useLocale, useT } from "@/lib/i18n";
import type { KanbanTimelineRun } from "@/lib/hermes/deskrpg-plugin-types";
import {
  axisLabelKind,
  axisTicks,
  barDurationMs,
  dependencyEdges,
  layoutTimeline,
  outcomeLegend,
  targetMarker,
  type OutcomeLegendEntry,
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

// `actionable` 은 실패색이 아니라 주의색이다 — 한도·차단·변경요청은 사용자가 할 일이 있는
// 상태이고, 빨강으로 칠하면 "고장" 으로 읽혀 그 할 일을 놓친다. `npc`(앰버)를 쓰는 이유는
// **`warning` 토큰이 없기 때문이다** — `tokens.css` 에 `--color-warning` 이 정의돼 있지 않아
// `fill-warning` 은 아무 색도 내지 않는다(실측).
const TONE_CLASS: Record<RunTone, string> = {
  running: "fill-primary",
  done: "fill-success",
  failed: "fill-danger",
  actionable: "fill-npc",
  neutral: "fill-info",
  unknown: "fill-text-muted",
};

/** 범례 점은 막대와 **같은** 색을 써야 한다 — 다르면 범례가 거짓말을 한다. */
const TONE_DOT: Record<RunTone, string> = {
  running: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
  actionable: "bg-npc",
  neutral: "bg-info",
  unknown: "bg-text-muted",
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
  /** 그림 위에 얹는 것(운영 지표 요약). 타임라인이 내용을 모른 채 자리만 준다. */
  header?: React.ReactNode;
  /**
   * 이 보드가 속한 프로젝트의 목표일(`YYYY-MM-DD`). `null` 이면 세로선을 그리지 않는다 —
   * 지금은 프로젝트를 만드는 화면이 없어 값이 없는 것이 기본이다.
   *
   * **선택 prop 이 아니다.** 처음에는 `?` 를 붙였는데, 모달이 값을 계산만 하고 넘기지 않아도
   * 타입 검사가 조용했다 — 실제 화면에는 목표일도 화살표도 안 나오는데 컴포넌트 테스트는
   * prop 을 직접 주니 초록이었다. 빠뜨리면 컴파일러가 잡게 필수로 둔다.
   */
  targetDate: string | null;
  /** 부모·자식 쌍. 양쪽이 다 보일 때만 화살표가 된다. 같은 이유로 필수다. */
  links: readonly { parent_id: string; child_id: string }[];
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
  header,
  targetDate,
  links,
}: KanbanTimelineProps) {
  const t = useT();
  const { locale } = useLocale();
  const layout = useMemo(() => layoutTimeline(runs, win, now), [runs, win, now]);
  const ticks = useMemo(() => axisTicks(win), [win]);
  const target = useMemo(() => targetMarker(targetDate, win, now), [targetDate, win, now]);
  const edges = useMemo(() => dependencyEdges(layout.rows, links ?? []), [layout.rows, links]);
  const legend = useMemo(() => outcomeLegend(layout.rows), [layout.rows]);

  // 창이 하루를 넘으면 시:분만으로는 눈금을 구분할 수 없다 — 주 단위 창에서 라벨 일곱 개가
  // 모두 "오전 09:00" 이던 실측 결함이 이것이다. 날짜 라벨에 요일을 붙이는 것은 주 단위 창에서
  // "언제가 월요일인가" 가 곧 읽는 사람이 찾는 것이기 때문이다.
  const labelKind = axisLabelKind(win);
  const clock = (ms: number) =>
    labelKind === "time"
      ? new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : new Date(ms).toLocaleDateString(locale, {
          month: "numeric",
          day: "numeric",
          weekday: "short",
        });
  const stamp = (ms: number) => new Date(ms).toLocaleString(locale);

  const rowTops: number[] = [];
  let height = AXIS_HEIGHT;
  for (const row of layout.rows) {
    rowTops.push(height);
    height += row.lanes * LANE_HEIGHT + (row.lanes - 1) * LANE_GAP + ROW_GAP;
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto p-2 sm:p-4">
      {header}
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
        <TargetChip target={target} />
      </div>

      <OutcomeLegend entries={legend} t={t} />

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

            {target.kind === "inWindow" && (
              <g>
                <line
                  x1={ROW_LABEL_WIDTH + target.x * PLOT_WIDTH}
                  y1={AXIS_HEIGHT - 6}
                  x2={ROW_LABEL_WIDTH + target.x * PLOT_WIDTH}
                  y2={height}
                  className="stroke-danger"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  data-timeline-target={new Date(target.atMs).toISOString()}
                />
                <title>{t("kanban.timeline.targetLine", { date: stamp(target.atMs) })}</title>
              </g>
            )}

            {edges.map((edge) => (
              <Arrow
                key={`${edge.parentTaskId}->${edge.childTaskId}`}
                edge={edge}
                rowTops={rowTops}
              />
            ))}

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

/**
 * 목표일 칩. 창 안이면 세로선이 이미 있으니 날짜만, 창 밖이면 **남은 일수와 방향**을 쓴다 —
 * 선을 창 경계에 붙이면 목표일이 그 시각인 것처럼 보인다.
 */
function TargetChip({ target }: { target: ReturnType<typeof targetMarker> }) {
  const t = useT();
  const { locale } = useLocale();
  if (target.kind === "none") {
    // 프로젝트를 만드는 화면이 아직 없어 목표일이 비는 것이 기본이다. 조용히 말한다.
    return <span className="text-text-dim">{t("kanban.timeline.noTarget")}</span>;
  }
  const date = new Date(target.atMs).toLocaleDateString(locale);
  if (target.kind === "inWindow") {
    return <span className="text-danger">{t("kanban.timeline.target", { date })}</span>;
  }
  const overdue = target.daysFromNow < 0;
  return (
    <span className={overdue ? "text-danger" : "text-text-secondary"}>
      {overdue
        ? t("kanban.timeline.targetPast", { date, days: Math.abs(target.daysFromNow) })
        : t("kanban.timeline.targetAhead", { date, days: target.daysFromNow })}
    </span>
  );
}

/**
 * 의존 화살표. 부모 링크가 곧 실행 순서라(Hermes 는 부모가 끝나야 자식을 집는다) 부모의 끝에서
 * 자식의 시작으로 그린다. 순서가 뒤집힌 것은 점선으로 드러낸다 — 정상적으로는 생기지 않는다.
 */
function Arrow({
  edge,
  rowTops,
}: {
  edge: ReturnType<typeof dependencyEdges>[number];
  rowTops: readonly number[];
}) {
  const y1 = rowTops[edge.from.row] + edge.from.lane * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2;
  const y2 = rowTops[edge.to.row] + edge.to.lane * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2;
  const x1 = ROW_LABEL_WIDTH + edge.from.x * PLOT_WIDTH;
  const x2 = ROW_LABEL_WIDTH + edge.to.x * PLOT_WIDTH;
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      className={edge.outOfOrder ? "stroke-danger" : "stroke-text-dim"}
      data-timeline-edge={`${edge.parentTaskId}->${edge.childTaskId}`}
      strokeWidth={1}
      strokeDasharray={edge.outOfOrder ? "3 2" : undefined}
      opacity={0.6}
    />
  );
}

/**
 * 범례 — 화면에 **실제로 있는** 결과만. 항목 이름은 `outcome` 문자열 그대로다.
 *
 * tone 고정 목록을 쓰면 모르는 값이 "기타" 한 칸에 뭉개져 이름을 잃는다. 실측에서 실행 178건
 * 중 177건이 `rate_limited` 였는데 색 매핑에 없어 회색으로 그려졌고, 화면에는 그 이름을 설명할
 * 곳이 없었다. 값을 항목으로 쓰면 코어가 어휘를 늘려도 이름은 잃지 않는다.
 */
function OutcomeLegend({
  entries,
  t,
}: {
  entries: readonly OutcomeLegendEntry[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (entries.length === 0) return null;
  return (
    <ul
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary"
      aria-label={t("kanban.timeline.legend")}
    >
      {entries.map((entry) => (
        <li key={`${entry.tone}:${entry.outcome ?? ""}`} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-sm ${TONE_DOT[entry.tone]}`}
          />
          <span data-timeline-legend={entry.outcome ?? entry.tone}>
            {entry.outcome ?? t(`kanban.timeline.tone.${entry.tone}`)}
          </span>
          <span className="text-text-muted">{entry.count}</span>
        </li>
      ))}
    </ul>
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
