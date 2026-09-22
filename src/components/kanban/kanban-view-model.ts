import { classifyGateFailure } from "@/lib/gate-failure";
import { taskTimeMs } from "@/lib/plugin-time";
import { PLUGIN_INSTALL_COMMAND as SHARED_PLUGIN_INSTALL_COMMAND } from "@/lib/hermes/plugin-install-command";
/**
 * 칸반 화면의 순수 뷰모델 — React·fetch 를 모른다.
 *
 * 열 순서(R6), 담당자 ↔ NPC 매핑(R7), 카드 요약(진행률·경과·경고 배지), 그리고 서버 오류를
 * 화면 분기(428·409·503·그 외, R31/R32)로 접는 규칙을 여기에 고정한다. 컴포넌트는 이 함수들의
 * 결과만 그린다 — 상태를 재해석하거나 열을 발명하지 않는다.
 */

import {
  KANBAN_TASK_STATUSES,
  type KanbanBoard,
  type KanbanComment,
  type KanbanTask,
  type KanbanTaskStatus,
} from "@/lib/hermes/deskrpg-plugin-types";

// ---------------------------------------------------------------------------
// 열 (R6)
// ---------------------------------------------------------------------------

/** 보드 열의 고정 순서. 서버 응답의 열 순서와 무관하게 이 순서로 그린다. */
export const KANBAN_COLUMN_ORDER: readonly KanbanTaskStatus[] = KANBAN_TASK_STATUSES;

export type OrderedColumn = { name: KanbanTaskStatus; tasks: KanbanTask[] };

/**
 * 응답의 열을 고정 순서로 정렬한다. 응답에 없는 열은 빈 열로 채우고, 모르는 이름의 열은
 * 버린다(상태를 발명하지 않는다). `archived` 열은 `includeArchived` 일 때만 남긴다.
 */
export function orderColumns(
  columns: KanbanBoard["columns"] | undefined,
  includeArchived: boolean,
): OrderedColumn[] {
  const byName = new Map<string, KanbanTask[]>();
  for (const column of columns ?? []) byName.set(column.name, column.tasks ?? []);
  return KANBAN_COLUMN_ORDER.filter((name) => includeArchived || name !== "archived").map(
    (name) => ({ name, tasks: byName.get(name) ?? [] }),
  );
}

// ---------------------------------------------------------------------------
// 담당자 ↔ NPC (R7)
// ---------------------------------------------------------------------------

export type BoardNpc = { npcId: string; npcName: string; profileName: string; active: boolean };

/** 생성·재배정 선택지 — 출근 중(active)인 NPC 만. */
export function activeAssigneeOptions(npcs: readonly BoardNpc[]): BoardNpc[] {
  return npcs.filter((npc) => npc.active);
}

/**
 * 카드에 실린 `assignee`(프로필 이름)를 화면 이름으로. 이 채널의 NPC 면 NPC 이름, 아니면
 * 프로필 이름 그대로(밖에서 만든 카드). 담당이 없으면 null.
 */
export function assigneeLabel(
  assignee: string | undefined | null,
  npcs: readonly BoardNpc[],
): string | null {
  if (!assignee) return null;
  const npc = npcs.find((entry) => entry.profileName === assignee);
  return npc ? npc.npcName : assignee;
}

/** 프로필 이름 → npcId (재배정 select 의 초기값용). 채널 NPC 가 아니면 null. */
export function npcIdForAssignee(
  assignee: string | undefined | null,
  npcs: readonly BoardNpc[],
): string | null {
  if (!assignee) return null;
  return npcs.find((entry) => entry.profileName === assignee)?.npcId ?? null;
}

// ---------------------------------------------------------------------------
// 카드 요약
// ---------------------------------------------------------------------------

/** `done/total` 문자열. 진행률이 없거나 total 이 0 이면 null. */
export function progressLabel(task: Pick<KanbanTask, "progress">): string | null {
  const p = task.progress;
  if (!p || typeof p.total !== "number" || p.total <= 0) return null;
  return `${p.done}/${p.total}`;
}

/**
 * 실행 중 카드의 경과 초. `started_at` 이 없으면 null. 마지막 heartbeat 가 시작보다 뒤이고
 * 현재 시각을 모르면(now 미지정) heartbeat 까지의 경과를 쓴다.
 */
export function elapsedSeconds(
  task: Pick<KanbanTask, "started_at" | "last_heartbeat_at">,
  now?: number,
): number | null {
  const started = taskTimeMs(task.started_at);
  if (started === null) return null;
  let end = now;
  if (end === undefined) {
    const heartbeat = taskTimeMs(task.last_heartbeat_at);
    end = heartbeat ?? Date.now();
  }
  return Math.max(0, Math.floor((end - started) / 1000));
}

/** `1h 02m` · `5m 07s` · `42s` */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export type WarningBadge = { count: number; severity: "critical" | "error" | "warning" };

/** 경고 배지. `warnings.count` 가 0 이하이면 null. 모르는 severity 는 `warning` 으로 접는다. */
export function warningBadge(task: Pick<KanbanTask, "warnings">): WarningBadge | null {
  const w = task.warnings;
  if (!w || typeof w.count !== "number" || w.count <= 0) return null;
  const severity =
    w.highest_severity === "critical" || w.highest_severity === "error"
      ? w.highest_severity
      : "warning";
  return { count: w.count, severity };
}

/** 카드가 실행 중인가 — 열 이름이 아니라 `started_at` 이 있고 `running` 인 경우. */
export function isRunning(task: Pick<KanbanTask, "status" | "started_at">): boolean {
  return task.status === "running" && Boolean(task.started_at);
}

/** 보드 전체 카드(열 순서대로). 선행 카드 선택지·링크 이름 찾기에 쓴다. */
export function flattenTasks(columns: readonly OrderedColumn[]): KanbanTask[] {
  return columns.flatMap((column) => column.tasks);
}

/** id → 제목. 링크 목록에서 id 만 오는 경우에 붙인다. 못 찾으면 id 그대로. */
export function taskTitleById(tasks: readonly KanbanTask[], id: string): string {
  return tasks.find((task) => task.id === id)?.title ?? id;
}

// ---------------------------------------------------------------------------
// 서버 오류 → 화면 분기 (R31/R32/E6)
// ---------------------------------------------------------------------------

/** 정본은 `@/lib/hermes/plugin-install-command` 다 — 여기서는 기존 import 경로를 지킨다. */
export const PLUGIN_INSTALL_COMMAND = SHARED_PLUGIN_INSTALL_COMMAND;

export type KanbanFailure = { status: number; code: string; message: string; minVersion?: string };

export type BoardBlocker =
  | { kind: "upgrade_required"; minVersion: string; command: string }
  | { kind: "gateway_not_bound" }
  | { kind: "board_unavailable"; code: string; reason: string }
  | { kind: "other"; status: number; code: string; message: string };

/** 보드를 못 여는 오류를 화면 분기로. 그 외 오류는 코드·메시지를 그대로 싣는다. */
export function classifyBoardFailure(
  failure: KanbanFailure,
  fallbackMinVersion = "0.6.0",
): BoardBlocker {
  // 판정은 `@/lib/gate-failure` 하나다 — 여기서는 보드 화면의 이름으로 옮기기만 한다.
  const blocker = classifyGateFailure({
    status: failure.status,
    code: failure.code,
    message: failure.message,
    minVersion: failure.minVersion,
  });

  if (blocker.kind === "plugin_upgrade_required") {
    return {
      kind: "upgrade_required",
      minVersion: failure.minVersion || fallbackMinVersion,
      command: blocker.command,
    };
  }
  if (blocker.kind === "gateway_not_bound") return { kind: "gateway_not_bound" };
  // 428 은 위에서 잡혔다. 503 은 보드가 열리지 않는 상태라 화면이 따로 다룬다.
  if (failure.status === 503) {
    return { kind: "board_unavailable", code: failure.code, reason: failure.message };
  }
  return {
    kind: "other",
    status: failure.status,
    code: failure.code,
    message: failure.message,
  };
}

/** 오류를 한 줄로. 메시지가 코드와 같으면 코드만 — `code: code` 로 두 번 찍지 않는다. */
export function failureLine(failure: Pick<KanbanFailure, "code" | "message">): string {
  return failure.message && failure.message !== failure.code
    ? `${failure.code}: ${failure.message}`
    : failure.code;
}

// ---------------------------------------------------------------------------
// 폼 (R8) — 화면 값 → 서버 본문
// ---------------------------------------------------------------------------

export type TaskFormValues = {
  reviewMode?: "human" | "agent";
  reviewerNpcId?: string;
  reviewRevision?: number;
  title: string;
  body: string;
  assigneeNpcId: string;
  priority: string;
  parents: string[];
  workspaceKind: "" | "scratch" | "worktree" | "dir";
  workspacePath: string;
  skills: string;
  modelOverride: string;
  providerOverride: string;
  reasoningEffort: string;
  maxRuntimeSeconds: string;
  goalMode: boolean;
  goalMaxTurns: string;
};

export type ChatTaskDraft = Pick<TaskFormValues, "title" | "body" | "assigneeNpcId">;

export const EMPTY_TASK_FORM: TaskFormValues = {
  reviewMode: "human",
  reviewerNpcId: "",
  title: "",
  body: "",
  assigneeNpcId: "",
  priority: "",
  parents: [],
  workspaceKind: "",
  workspacePath: "",
  skills: "",
  modelOverride: "",
  providerOverride: "",
  reasoningEffort: "",
  maxRuntimeSeconds: "",
  goalMode: false,
  goalMaxTurns: "",
};

/** 쉼표·줄바꿈으로 나눈 스킬 목록. 빈 항목은 버린다. */
export function parseSkills(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 폼 값 → `POST/PATCH /kanban/tasks` 본문. 비어 있는 필드는 싣지 않는다 — 서버가 모르는 키를
 * 버리긴 하지만, 빈 문자열을 보내면 Hermes 가 "빈 값으로 덮어쓰기" 로 받을 수 있다.
 * 담당은 npcId 로 보낸다(서버가 프로필 이름으로 바꾼다).
 */
export function taskFormToBody(values: TaskFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = { title: values.title.trim() };
  if (values.reviewMode) {
    body.reviewPolicy =
      values.reviewMode === "agent"
        ? { mode: "agent", reviewerNpcId: values.reviewerNpcId }
        : { mode: "human" };
    if (values.reviewRevision !== undefined) body.expected_revision = values.reviewRevision;
  }
  if (values.body.trim()) body.body = values.body;
  if (values.assigneeNpcId) body.assignee = values.assigneeNpcId;
  if (values.priority.trim()) body.priority = values.priority.trim();
  if (values.parents.length) body.parents = values.parents;
  if (values.workspaceKind) body.workspace_kind = values.workspaceKind;
  if (values.workspacePath.trim()) body.workspace_path = values.workspacePath.trim();
  const skills = parseSkills(values.skills);
  if (skills.length) body.skills = skills;
  if (values.modelOverride.trim()) body.model_override = values.modelOverride.trim();
  if (values.providerOverride.trim()) body.provider_override = values.providerOverride.trim();
  if (values.reasoningEffort.trim()) body.reasoning_effort = values.reasoningEffort.trim();
  const runtime = Number(values.maxRuntimeSeconds);
  if (values.maxRuntimeSeconds.trim() && Number.isFinite(runtime) && runtime > 0) {
    body.max_runtime_seconds = Math.floor(runtime);
  }
  if (values.goalMode) {
    body.goal_mode = true;
    const turns = Number(values.goalMaxTurns);
    if (values.goalMaxTurns.trim() && Number.isFinite(turns) && turns > 0) {
      body.goal_max_turns = Math.floor(turns);
    }
  }
  return body;
}

// ---------------------------------------------------------------------------
// 블랙보드 필터 (스웜)
// ---------------------------------------------------------------------------

/** Hermes `kanban_swarm.BLACKBOARD_PREFIX` 와 **같은 문자열이어야 한다.** */
export const BLACKBOARD_PREFIX = "[swarm:blackboard] ";

/**
 * 블랙보드 코멘트를 스레드에서 걸러내고 key 별 최신값으로 병합한다.
 *
 * `create_swarm` 이 루트 카드에 `topology` 코멘트를 스스로 남기므로, 이 처리가 없으면
 * **모든** 스웜 루트 카드에서 사용자가 날 JSON 을 보게 된다(`TaskDrawer` 는 본문을
 * `whitespace-pre-wrap` 평문으로 그린다).
 *
 * 병합 규칙은 Hermes `latest_blackboard` 를 따른다 — 나중 코멘트가 같은 key 를 덮고,
 * 깨진 JSON 과 문자열 아닌 key 는 건너뛴다.
 */
export function splitBlackboardComments(comments: KanbanComment[]): {
  comments: KanbanComment[];
  blackboard: Record<string, unknown>;
  authors: Record<string, string>;
} {
  const rest: KanbanComment[] = [];
  const blackboard: Record<string, unknown> = {};
  const authors: Record<string, string> = {};
  for (const comment of comments) {
    const body = comment.body ?? "";
    if (!body.startsWith(BLACKBOARD_PREFIX)) {
      rest.push(comment);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.slice(BLACKBOARD_PREFIX.length));
    } catch {
      continue; // 깨진 것도 스레드로 되돌리지 않는다 — 사람에게 보일 내용이 아니다.
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const { key, value } = parsed as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !key) continue;
    blackboard[key] = value;
    authors[key] = comment.author;
  }
  return { comments: rest, blackboard, authors };
}
