/**
 * `deskrpg-hermes-plugin` 자동화 계약(v0.6.0+)을 흉내내는 **테스트 전용** 인메모리 HTTP 서버.
 *
 * 플러그인이 아직 없으므로, 스펙 A.1(오너 키 — 칸반·이벤트)·A.2(프로필 키 — 크론)·
 * A.3(인증)을 이 파일이 재현한다. 실제 클라이언트(`plugin-client.ts`)가 이 서버를 상대로
 * 왕복하면서 "경로·키·본문·응답 모양" 을 고정한다. 여기 있는 상태 전이는 **스펙이 정한
 * 것만** 따르고, 나머지(terminate 후 상태 등)는 테스트에 필요한 최소로 정했다 — 실제
 * 플러그인의 판단을 대신하려는 것이 아니다.
 *
 * ⚠️ 앱 코드에서 import 하지 않는다. `node:http` 를 쓰므로 브라우저 번들에 들어가면 안
 * 되고, 릴리스 이미지에도 필요 없다. `*.test.ts` 에서만 부른다.
 */

import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type {
  ArtifactKind,
  ArtifactSource,
  ArtifactSummary,
  ArtifactVersion,
  AutomationBlueprint,
  BoardMeta,
  CronDeliveryTarget,
  CronJob,
  CronRun,
  KanbanAttachment,
  KanbanBoard,
  KanbanColumn,
  KanbanComment,
  KanbanEvent,
  KanbanRun,
  KanbanTaskDetail,
  KanbanTaskFull,
  KanbanTaskStatus,
  OrchestrationSettings,
  PluginEvent,
  PluginInfo,
  WorkerLog,
} from "./deskrpg-plugin-types";
import { KANBAN_TASK_STATUSES } from "./deskrpg-plugin-types";
import { BLACKBOARD_PREFIX } from "@/components/kanban/kanban-view-model";

// ---------------------------------------------------------------------------
// 공개 표면
// ---------------------------------------------------------------------------

export type FakePluginServerOptions = {
  ownerToken: string;
  /** 프로필 이름 → 그 프로필의 키. 첫 항목이 기본 프로필이다. */
  profileTokens: Record<string, string>;
  info?: Partial<Omit<PluginInfo, "plugin">>;
};

/** 서버가 받은 요청 한 건. 테스트가 "무엇이 나갔는가" 를 확인하는 데 쓴다. */
export type RecordedRequest = {
  method: string;
  /** 경로 + 쿼리스트링 */
  path: string;
  auth: string | null;
  contentType: string | null;
  /** JSON 본문이면 파싱 결과, 아니면 null */
  json: unknown;
  status: number;
  /** 소문자 키로 정규화한 요청 헤더 전부. */
  headers: Record<string, string>;
};

export type FakePluginServer = {
  baseUrl: string;
  close(): Promise<void>;
  /** 보드·카드·이벤트·크론 상태를 전부 비운다(info 설정은 유지). */
  reset(): void;
  setInfo(patch: Partial<Omit<PluginInfo, "plugin">>): void;
  lastRequest(): RecordedRequest | null;
  requests(): RecordedRequest[];
  /** 통합 이벤트 스트림에 이벤트를 밀어 넣는다(id·ts 는 서버가 채운다). */
  pushEvent(event: Omit<PluginEvent, "id" | "ts"> & { ts?: number }): PluginEvent;
  setTaskLog(board: string, taskId: string, content: string): void;
  setDeliveryTargets(profile: string, targets: CronDeliveryTarget[]): void;
  setBlueprints(profile: string, blueprints: AutomationBlueprint[]): void;
  /** 아티팩트 하나를 상태에 심는다(버전 1). 기본 kind `document`, mime `text/markdown`,
   * filename `<title>.md`, source `chat`. */
  seedArtifact(input: {
    id: string;
    title: string;
    profile: string;
    board?: string | null;
    task_id?: string | null;
    kind?: ArtifactKind;
    mime?: string;
    filename?: string;
    body: string | Buffer;
    source_kind?: ArtifactSource;
  }): ArtifactSummary;
  /** 첨부 하나를 카드 없이도 상태에 심는다 — 보드가 없으면 만든다. */
  seedAttachment(input: {
    board: string;
    taskId: string;
    filename: string;
    body: string | Buffer;
  }): { id: string };
};

// ---------------------------------------------------------------------------
// 내부 상태
// ---------------------------------------------------------------------------

type TaskRecord = {
  task: KanbanTaskFull;
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
};

type BoardRecord = {
  meta: BoardMeta;
  tasks: Map<string, TaskRecord>;
  /** "parent|child" */
  links: Set<string>;
  attachments: Map<string, KanbanAttachment & { task_id: string; bytes: Buffer }>;
  logs: Map<string, string>;
};

type CronState = {
  jobs: Map<string, CronJob>;
  runs: Map<string, CronRun[]>;
  deliveryTargets: CronDeliveryTarget[];
  blueprints: AutomationBlueprint[];
};

type Reply = {
  status: number;
  body: unknown;
  /** 있으면 JSON 대신 이 바이트를 이 헤더로 그대로 내보낸다(아티팩트 원시 콘텐츠). */
  raw?: { bytes: Buffer; headers: Record<string, string> };
};

type ArtifactVersionRecord = { meta: ArtifactVersion; bytes: Buffer };
type ArtifactRecord = {
  summary: ArtifactSummary;
  versions: ArtifactVersionRecord[];
  deleted: boolean;
};

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const DEFAULT_EVENT_LIMIT = 200;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === "object" && body ? JSON.stringify(body) : String(body));
  }
}

const notFound = (what = "not_found") => new HttpError(404, { error: what });
const badRequest = (code: string, detail?: string) =>
  new HttpError(400, { error: code, ...(detail ? { detail } : {}) });

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------------

export async function startFakePluginServer(
  options: FakePluginServerOptions,
): Promise<FakePluginServer> {
  const profileNames = Object.keys(options.profileTokens);
  let info: PluginInfo = {
    plugin: "deskrpg",
    version: "0.6.0",
    capabilities: ["kanban", "cron", "events", "swarm"],
    timezone: "Asia/Seoul",
    kanban: { dispatcher_present: true, attachments: true },
    dashboard_url: null,
    ...options.info,
  };

  const recorded: RecordedRequest[] = [];
  let boards = new Map<string, BoardRecord>();
  let currentBoard: string | null = null;
  let events: PluginEvent[] = [];
  let cursors = new Set<string>();
  let orchestration: OrchestrationSettings = defaultOrchestration(profileNames);
  let cron = new Map<string, CronState>();
  let artifacts = new Map<string, ArtifactRecord>();
  let seq = 0;

  const nextId = (prefix: string) => `${prefix}_${(seq += 1).toString(36).padStart(4, "0")}`;

  function reset() {
    boards = new Map();
    currentBoard = null;
    events = [];
    cursors = new Set();
    orchestration = defaultOrchestration(profileNames);
    cron = new Map();
    artifacts = new Map();
    seq = 0;
  }

  function cronFor(profile: string): CronState {
    let state = cron.get(profile);
    if (!state) {
      state = { jobs: new Map(), runs: new Map(), deliveryTargets: [], blueprints: [] };
      cron.set(profile, state);
    }
    return state;
  }

  // ---- 이벤트 -------------------------------------------------------------

  function pushEvent(input: Omit<PluginEvent, "id" | "ts"> & { ts?: number }): PluginEvent {
    const event: PluginEvent = { ...input, id: nextId("ev"), ts: input.ts ?? Date.now() };
    events.push(event);
    return event;
  }

  function issueCursor(index: number): string {
    const token = `c${index}`;
    cursors.add(token);
    return token;
  }

  function pollEvents(params: URLSearchParams): Reply {
    const board = params.get("board") ?? undefined;
    const cursor = params.get("cursor");
    const limitRaw = params.get("limit");
    const limit = limitRaw ? Number(limitRaw) : DEFAULT_EVENT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) throw badRequest("invalid_limit");

    // 커서가 없으면 "지금" 토큰만 준다 — 과거 이벤트를 쏟지 않는다.
    if (cursor === null) {
      return {
        status: 200,
        body: { events: [], cursor: issueCursor(events.length), has_more: false },
      };
    }
    if (!cursors.has(cursor)) throw badRequest("unknown_cursor");
    const start = Number(cursor.slice(1));

    // 보드 필터: 그 보드의 이벤트와 보드가 없는 전역 이벤트(크론)를 통과시킨다.
    const matches = (e: PluginEvent) =>
      board === undefined || e.board === undefined || e.board === board;
    const page: PluginEvent[] = [];
    let index = start;
    let hasMore = false;
    for (; index < events.length; index += 1) {
      const e = events[index];
      if (!matches(e)) continue;
      if (page.length === limit) {
        hasMore = true;
        break;
      }
      page.push(e);
    }
    return { status: 200, body: { events: page, cursor: issueCursor(index), has_more: hasMore } };
  }

  // ---- 칸반 ---------------------------------------------------------------

  function boardOf(params: URLSearchParams): BoardRecord {
    const slug = params.get("board");
    if (!slug) throw badRequest("board_required");
    const record = boards.get(slug);
    if (!record) throw notFound("unknown_board");
    return record;
  }

  function taskOf(board: BoardRecord, id: string): TaskRecord {
    const record = board.tasks.get(id);
    if (!record) throw notFound();
    return record;
  }

  function parentCount(board: BoardRecord, id: string): number {
    let count = 0;
    for (const link of board.links) if (link.endsWith(`|${id}`)) count += 1;
    return count;
  }

  function linksOf(board: BoardRecord, id: string): { parents: string[]; children: string[] } {
    const parents: string[] = [];
    const children: string[] = [];
    for (const link of board.links) {
      const [parent, child] = link.split("|");
      if (child === id) parents.push(parent);
      if (parent === id) children.push(child);
    }
    return { parents, children };
  }

  function refreshLinkCounts(board: BoardRecord, id: string) {
    const record = board.tasks.get(id);
    if (!record) return;
    const links = linksOf(board, id);
    record.task.link_counts = { parents: links.parents.length, children: links.children.length };
  }

  function recordTaskEvent(record: TaskRecord, kind: string, payload: Record<string, unknown>) {
    record.events.push({ id: nextId("te"), kind, payload, created_at: nowIso() });
  }

  function setStatus(board: BoardRecord, record: TaskRecord, to: KanbanTaskStatus) {
    const from = record.task.status;
    if (from === to) return;
    record.task.status = to;
    if (to === "running") record.task.started_at = nowIso();
    if (to === "done") record.task.completed_at = nowIso();
    const payload = {
      from,
      to,
      parent_count: parentCount(board, record.task.id),
      title: record.task.title,
      assignee: record.task.assignee ?? null,
    };
    recordTaskEvent(record, "task.status", payload);
    pushEvent({ kind: "task.status", board: board.meta.slug, task_id: record.task.id, payload });
  }

  function createBoard(body: Record<string, unknown>): Reply {
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (!SLUG_RE.test(slug)) throw badRequest("invalid_slug");
    const existing = boards.get(slug);
    // 같은 slug 는 만들지 않고 기존 것을 200 으로 돌려준다(스펙).
    if (existing) return { status: 200, body: { board: boardMeta(existing) } };
    const record: BoardRecord = {
      meta: {
        slug,
        name: typeof body.name === "string" ? body.name : slug,
        ...(typeof body.default_workdir === "string"
          ? { default_workdir: body.default_workdir }
          : {}),
      },
      tasks: new Map(),
      links: new Set(),
      attachments: new Map(),
      logs: new Map(),
    };
    boards.set(slug, record);
    if (currentBoard === null) currentBoard = slug;
    return { status: 201, body: { board: boardMeta(record) } };
  }

  function boardMeta(record: BoardRecord): BoardMeta {
    return {
      ...record.meta,
      is_current: record.meta.slug === currentBoard,
      total: record.tasks.size,
    };
  }

  function renderBoard(board: BoardRecord, includeArchived: boolean): KanbanBoard {
    const columns: KanbanColumn[] = KANBAN_TASK_STATUSES.filter(
      (status) => includeArchived || status !== "archived",
    ).map((name) => ({ name, tasks: [] }));
    const tenants = new Set<string>();
    const assignees = new Set<string>();
    for (const { task } of board.tasks.values()) {
      const column = columns.find((c) => c.name === task.status);
      if (!column) continue;
      column.tasks.push(summaryOf(task));
      if (task.tenant) tenants.add(task.tenant);
      if (task.assignee) assignees.add(task.assignee);
    }
    return {
      columns,
      tenants: [...tenants],
      assignees: [...assignees],
      latest_event_id: events.length > 0 ? events[events.length - 1].id : null,
      now: nowIso(),
    };
  }

  /** 상세 전용 필드를 뺀 카드 요약 — 보드 열에는 이 모양이 실린다. */
  function summaryOf(task: KanbanTaskFull) {
    const {
      result: _result,
      created_by: _createdBy,
      diagnostics: _diagnostics,
      workspace_kind: _wk,
      workspace_path: _wp,
      branch_name: _bn,
      ...summary
    } = task;
    return summary;
  }

  function createTask(board: BoardRecord, body: Record<string, unknown>): Reply {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw badRequest("title_required");
    const id = nextId("task");
    const parents = Array.isArray(body.parents)
      ? body.parents.filter((p): p is string => typeof p === "string")
      : [];
    for (const parent of parents) if (!board.tasks.has(parent)) throw notFound("unknown_parent");

    const task: KanbanTaskFull = {
      id,
      title,
      status: body.triage === true ? "triage" : "todo",
      created_at: nowIso(),
      comment_count: 0,
      link_counts: { parents: parents.length, children: 0 },
      ...pick(body, [
        "body",
        "assignee",
        "tenant",
        "priority",
        "workspace_kind",
        "workspace_path",
        "model_override",
        "provider_override",
        "reasoning_effort",
      ]),
    };
    const record: TaskRecord = { task, comments: [], events: [], runs: [] };
    board.tasks.set(id, record);
    for (const parent of parents) {
      board.links.add(`${parent}|${id}`);
      refreshLinkCounts(board, parent);
    }
    recordTaskEvent(record, "task.created", { title });
    pushEvent({
      kind: "task.created",
      board: board.meta.slug,
      task_id: id,
      payload: { title, status: task.status, assignee: task.assignee ?? null },
    });
    return { status: 201, body: { task: summaryOf(task) } };
  }

  // ---- 스웜(v0.7.0+) --------------------------------------------------------
  //
  // 실제 그래프 오케스트레이션은 흉내내지 않는다. 기존 `createTask`/`addComment`
  // 로 루트·워커·검증·합성 카드 4장을 만들고 링크를 걸어, 클라이언트가 "경로·본문·
  // 응답 모양" 을 왕복 검증하게 하는 것이 이 서버의 유일한 목적이다.

  function newTaskId(board: BoardRecord, body: Record<string, unknown>): string {
    const reply = createTask(board, body);
    return (reply.body as { task: { id: string } }).task.id;
  }

  function createSwarm(board: BoardRecord, body: Record<string, unknown>): Reply {
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    if (!goal) throw badRequest("invalid_field", "goal");
    const rawWorkers = Array.isArray(body.workers) ? body.workers : [];
    if (rawWorkers.length === 0) throw badRequest("workers_required");

    const rootId = newTaskId(board, { title: goal });
    const workerIds = rawWorkers.map((raw) => {
      const w = raw as { profile?: unknown; title?: unknown };
      // 실제 플러그인은 `require_str` 로 빈 title 을 400 `invalid_field` 거절한다.
      const title = typeof w.title === "string" ? w.title.trim() : "";
      if (!title) throw badRequest("invalid_field", "title");
      return newTaskId(board, { title, assignee: w.profile });
    });
    const verifierId = newTaskId(board, {
      title: "Verify swarm outputs",
      assignee: body.verifier,
      parents: workerIds,
    });
    const synthesizerId = newTaskId(board, {
      title: "Synthesize swarm outputs",
      assignee: body.synthesizer,
      parents: [verifierId],
    });

    // 진짜 `create_swarm` 도 이 코멘트를 남긴다 — 없으면 블랙보드 필터 테스트가 무의미해진다.
    addComment(board, rootId, {
      author: "swarm-orchestrator",
      body:
        BLACKBOARD_PREFIX +
        JSON.stringify({
          key: "topology",
          value: {
            goal,
            root_id: rootId,
            worker_ids: workerIds,
            verifier_id: verifierId,
            synthesizer_id: synthesizerId,
          },
        }),
    });

    return {
      status: 200,
      body: {
        root_id: rootId,
        worker_ids: workerIds,
        verifier_id: verifierId,
        synthesizer_id: synthesizerId,
      },
    };
  }

  function blackboardOf(board: BoardRecord, taskId: string): Reply {
    const record = board.tasks.get(taskId);
    if (!record) throw notFound("task_not_found");
    const merged: Record<string, unknown> = {};
    const authors: Record<string, string> = {};
    for (const comment of record.comments) {
      if (!comment.body.startsWith(BLACKBOARD_PREFIX)) continue;
      try {
        const parsed = JSON.parse(comment.body.slice(BLACKBOARD_PREFIX.length));
        if (typeof parsed.key === "string" && parsed.key) {
          merged[parsed.key] = parsed.value;
          authors[parsed.key] = comment.author;
        }
      } catch {
        // 깨진 JSON 은 건너뛴다 — Hermes `latest_blackboard` 와 같은 동작.
      }
    }
    if (Object.keys(authors).length > 0) merged._authors = authors;
    return { status: 200, body: { blackboard: merged } };
  }

  function updateTask(board: BoardRecord, id: string, body: Record<string, unknown>): Reply {
    const record = taskOf(board, id);
    const { status, ...rest } = body;
    Object.assign(
      record.task,
      pick(rest, [
        "title",
        "body",
        "assignee",
        "tenant",
        "priority",
        "workspace_kind",
        "workspace_path",
        "model_override",
        "provider_override",
        "reasoning_effort",
      ]),
    );
    if (status !== undefined) {
      if (!isTaskStatus(status)) throw badRequest("invalid_status");
      setStatus(board, record, status);
    }
    return { status: 200, body: { task: summaryOf(record.task) } };
  }

  function deleteTask(board: BoardRecord, id: string): Reply {
    const record = taskOf(board, id);
    board.tasks.delete(id);
    for (const link of [...board.links]) {
      const [parent, child] = link.split("|");
      if (parent === id || child === id) {
        board.links.delete(link);
        refreshLinkCounts(board, parent === id ? child : parent);
      }
    }
    pushEvent({
      kind: "task.deleted",
      board: board.meta.slug,
      task_id: id,
      payload: { title: record.task.title },
    });
    return { status: 200, body: { ok: true } };
  }

  function addComment(board: BoardRecord, id: string, body: Record<string, unknown>): Reply {
    const record = taskOf(board, id);
    if (typeof body.author !== "string" || typeof body.body !== "string") {
      throw badRequest("invalid_comment");
    }
    const comment: KanbanComment = {
      id: nextId("cmt"),
      author: body.author,
      body: body.body,
      created_at: nowIso(),
    };
    record.comments.push(comment);
    record.task.comment_count = record.comments.length;
    recordTaskEvent(record, "task.comment", { author: comment.author });
    pushEvent({
      kind: "task.comment",
      board: board.meta.slug,
      task_id: id,
      payload: { author: comment.author, comment_id: comment.id },
    });
    return { status: 201, body: { comment } };
  }

  function runTaskAction(
    board: BoardRecord,
    id: string,
    action: string,
    body: Record<string, unknown>,
  ): Reply {
    const record = taskOf(board, id);
    switch (action) {
      case "reassign": {
        if (typeof body.profile !== "string") throw badRequest("profile_required");
        if (body.reclaim_first === true && record.task.status === "running") {
          setStatus(board, record, "ready");
        }
        record.task.assignee = body.profile;
        break;
      }
      case "reclaim":
        if (record.task.status === "running") setStatus(board, record, "ready");
        break;
      case "specify":
      case "decompose":
      case "estimate":
        // 실제 플러그인은 오케스트레이터 세션을 띄운다. 여기서는 이력만 남긴다.
        recordTaskEvent(record, `task.${action}`, {});
        break;
      case "approve":
        setStatus(board, record, "done");
        break;
      case "request-changes": {
        if (typeof body.comment !== "string") throw badRequest("comment_required");
        record.comments.push({
          id: nextId("cmt"),
          author: "reviewer",
          body: body.comment,
          created_at: nowIso(),
        });
        record.task.comment_count = record.comments.length;
        setStatus(board, record, "todo");
        break;
      }
      case "unblock":
        if (typeof body.comment === "string") {
          record.comments.push({
            id: nextId("cmt"),
            author: "operator",
            body: body.comment,
            created_at: nowIso(),
          });
          record.task.comment_count = record.comments.length;
        }
        setStatus(board, record, "ready");
        break;
      case "terminate": {
        const run = record.runs.find((r) => r.status === "running");
        if (run) {
          run.status = "terminated";
          run.ended_at = nowIso();
          pushEvent({
            kind: "task.run.finished",
            board: board.meta.slug,
            task_id: id,
            run_id: run.id,
            payload: { status: "terminated" },
          });
        }
        setStatus(board, record, "blocked");
        break;
      }
      case "archive":
        setStatus(board, record, "archived");
        break;
      default:
        throw notFound("unknown_action");
    }
    return { status: 200, body: { task: summaryOf(record.task) } };
  }

  function dispatch(board: BoardRecord, params: URLSearchParams): Reply {
    const maxRaw = params.get("max");
    const max = maxRaw ? Number(maxRaw) : 8;
    if (!Number.isInteger(max) || max < 1) throw badRequest("invalid_max");
    const spawned: Array<{ task_id: string; profile?: string; run_id?: string }> = [];
    for (const record of board.tasks.values()) {
      if (spawned.length >= max) break;
      if (record.task.status !== "ready") continue;
      const profile = record.task.assignee ?? orchestration.resolved_default_assignee ?? undefined;
      const run: KanbanRun = {
        id: nextId("run"),
        profile,
        status: "running",
        started_at: nowIso(),
        worker_pid: 40000 + record.runs.length,
      };
      record.runs.push(run);
      record.task.worker_pid = run.worker_pid;
      setStatus(board, record, "running");
      pushEvent({
        kind: "task.run.started",
        board: board.meta.slug,
        task_id: record.task.id,
        profile,
        run_id: run.id,
        payload: { profile: profile ?? null },
      });
      spawned.push({ task_id: record.task.id, profile, run_id: run.id });
    }
    return { status: 200, body: { spawned } };
  }

  function taskLog(board: BoardRecord, id: string, params: URLSearchParams): Reply {
    taskOf(board, id);
    const content = board.logs.get(id);
    if (content === undefined) {
      const empty: WorkerLog = { exists: false, size_bytes: 0, content: "", truncated: false };
      return { status: 200, body: empty };
    }
    const tailRaw = params.get("tail");
    const tail = tailRaw ? Number(tailRaw) : null;
    const lines = content.split("\n");
    // 끝의 빈 조각(마지막 개행 뒤)은 줄이 아니다.
    const nonEmpty = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
    let out = content;
    let truncated = false;
    if (tail !== null && Number.isInteger(tail) && tail >= 0 && tail < nonEmpty.length) {
      out =
        nonEmpty.slice(nonEmpty.length - tail).join("\n") + (content.endsWith("\n") ? "\n" : "");
      truncated = true;
    }
    const log: WorkerLog = {
      exists: true,
      size_bytes: Buffer.byteLength(content),
      content: out,
      truncated,
    };
    return { status: 200, body: log };
  }

  function detailOf(board: BoardRecord, id: string): KanbanTaskDetail {
    const record = taskOf(board, id);
    return {
      task: record.task,
      comments: record.comments,
      events: record.events,
      attachments: info.kanban.attachments
        ? [...board.attachments.values()]
            .filter((a) => a.task_id === id)
            .map(({ task_id: _taskId, ...rest }) => rest)
        : null,
      links: linksOf(board, id),
      runs: record.runs,
    };
  }

  function mutateLink(board: BoardRecord, body: Record<string, unknown>, add: boolean): Reply {
    const parent = body.parent_id;
    const child = body.child_id;
    if (typeof parent !== "string" || typeof child !== "string") throw badRequest("invalid_link");
    if (parent === child) throw badRequest("self_link");
    taskOf(board, parent);
    taskOf(board, child);
    const key = `${parent}|${child}`;
    if (add) board.links.add(key);
    else board.links.delete(key);
    refreshLinkCounts(board, parent);
    refreshLinkCounts(board, child);
    pushEvent({
      kind: "task.link",
      board: board.meta.slug,
      task_id: child,
      payload: { parent_id: parent, child_id: child, op: add ? "add" : "remove" },
    });
    return { status: 200, body: { ok: true } };
  }

  function uploadAttachment(board: BoardRecord, id: string, req: ParsedRequest): Reply {
    if (!info.kanban.attachments) throw notFound("attachments_disabled");
    taskOf(board, id);
    const part = parseMultipartFile(req.contentType, req.raw);
    if (!part) throw badRequest("invalid_multipart");
    const attachment = {
      id: nextId("att"),
      filename: part.filename,
      size: part.size,
      task_id: id,
      bytes: part.content,
    };
    board.attachments.set(attachment.id, attachment);
    const { task_id: _taskId, bytes: _bytes, ...publicShape } = attachment;
    return { status: 201, body: { attachment: publicShape } };
  }

  /** 첨부 바이트를 내려준다(`kanban_files.download_attachment_handler` 와 같은 모양). */
  function attachmentContent(
    attachment: KanbanAttachment & { task_id: string; bytes: Buffer },
    req: ParsedRequest,
  ): Reply {
    const bytes = attachment.bytes;
    const baseHeaders: Record<string, string> = {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${attachment.filename}"`,
      "accept-ranges": "bytes",
    };
    const range = req.headers.range;
    const rangeMatch = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (rangeMatch) {
      const total = bytes.length;
      const startByte =
        rangeMatch[1] === "" ? total - Number(rangeMatch[2]) : Number(rangeMatch[1]);
      const endByte = rangeMatch[2] === "" ? total - 1 : Number(rangeMatch[2]);
      const slice = bytes.subarray(startByte, endByte + 1);
      return {
        status: 206,
        body: null,
        raw: {
          bytes: slice,
          headers: {
            ...baseHeaders,
            "content-range": `bytes ${startByte}-${endByte}/${total}`,
            "content-length": String(slice.length),
          },
        },
      };
    }
    return {
      status: 200,
      body: null,
      raw: { bytes, headers: { ...baseHeaders, "content-length": String(bytes.length) } },
    };
  }

  /** 첨부 하나를 카드 없이도 상태에 심는다 — 보드가 없으면 만든다. */
  function seedAttachment(input: {
    board: string;
    taskId: string;
    filename: string;
    body: string | Buffer;
  }): { id: string } {
    let board = boards.get(input.board);
    if (!board) {
      board = {
        meta: { slug: input.board, name: input.board },
        tasks: new Map(),
        links: new Set(),
        attachments: new Map(),
        logs: new Map(),
      };
      boards.set(input.board, board);
      if (currentBoard === null) currentBoard = input.board;
    }
    const bytes = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : input.body;
    const id = nextId("att");
    board.attachments.set(id, {
      id,
      filename: input.filename,
      size: bytes.length,
      task_id: input.taskId,
      bytes,
    });
    return { id };
  }

  function updateOrchestration(body: Record<string, unknown>): Reply {
    const next = { ...orchestration };
    if ("orchestrator_profile" in body) {
      next.orchestrator_profile = stringOrNull(body.orchestrator_profile);
    }
    if ("default_assignee" in body) next.default_assignee = stringOrNull(body.default_assignee);
    if (typeof body.auto_decompose === "boolean") next.auto_decompose = body.auto_decompose;
    if (typeof body.max_in_progress === "number") next.max_in_progress = body.max_in_progress;
    if (typeof body.max_in_progress_per_profile === "number") {
      next.max_in_progress_per_profile = body.max_in_progress_per_profile;
    }
    next.resolved_orchestrator_profile = next.orchestrator_profile ?? profileNames[0] ?? null;
    next.resolved_default_assignee = next.default_assignee ?? profileNames[0] ?? null;
    orchestration = next;
    return { status: 200, body: orchestration };
  }

  // ---- 크론 ---------------------------------------------------------------

  function jobOf(state: CronState, id: string): CronJob {
    const job = state.jobs.get(id);
    if (!job) throw notFound();
    return job;
  }

  function createJob(profile: string, body: Record<string, unknown>): Reply {
    if (typeof body.schedule !== "string" || !body.schedule) throw badRequest("schedule_required");
    // 스크립트 전용 잡은 프롬프트가 없어도 된다(Hermes 와 같은 규칙).
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt && typeof body.script !== "string") throw badRequest("prompt_required");
    const paused = body.paused === true;
    const job: CronJob = {
      id: nextId("job"),
      name: typeof body.name === "string" ? body.name : prompt.slice(0, 40),
      prompt,
      schedule: { kind: "text", expr: body.schedule, display: body.schedule },
      schedule_display: body.schedule,
      repeat: body.repeat !== false,
      enabled: !paused,
      state: paused ? "paused" : "scheduled",
      next_run_at: paused ? null : nowIso(),
      last_run_at: null,
      last_status: null,
      last_error: null,
      deliver: typeof body.deliver === "string" ? body.deliver : null,
      skills: Array.isArray(body.skills)
        ? body.skills.filter((s): s is string => typeof s === "string")
        : [],
      model: typeof body.model === "string" ? body.model : null,
      provider: typeof body.provider === "string" ? body.provider : null,
      created_at: nowIso(),
    };
    cronFor(profile).jobs.set(job.id, job);
    return { status: 201, body: { job } };
  }

  function updateJob(state: CronState, id: string, body: Record<string, unknown>): Reply {
    const job = jobOf(state, id);
    const updates =
      typeof body.updates === "object" && body.updates !== null
        ? (body.updates as Record<string, unknown>)
        : null;
    if (!updates) throw badRequest("updates_required");
    if (typeof updates.schedule === "string") {
      job.schedule = { kind: "text", expr: updates.schedule, display: updates.schedule };
      job.schedule_display = updates.schedule;
    }
    if (typeof updates.prompt === "string") job.prompt = updates.prompt;
    if (typeof updates.name === "string") job.name = updates.name;
    if (typeof updates.deliver === "string") job.deliver = updates.deliver;
    if ("model" in updates) job.model = stringOrNull(updates.model);
    if ("provider" in updates) job.provider = stringOrNull(updates.provider);
    if (typeof updates.enabled === "boolean") {
      job.enabled = updates.enabled;
      job.state = updates.enabled ? "scheduled" : "disabled";
    }
    return { status: 200, body: { job } };
  }

  function runJob(profile: string, state: CronState, id: string): Reply {
    const job = jobOf(state, id);
    // 실제 플러그인은 비동기로 돌린다(202). 여기서는 즉시 끝난 것으로 기록해 이벤트
    // 두 개(started/finished)를 한 번에 스트림에 싣는다.
    const startedAt = nowIso();
    const sessionId = nextId("sess");
    const run: CronRun = {
      id: nextId("crun"),
      started_at: startedAt,
      ended_at: startedAt,
      status: "ok",
      summary: `ran ${job.name}`,
      result_text: "",
    };
    const runs = state.runs.get(id) ?? [];
    runs.unshift(run);
    state.runs.set(id, runs);
    job.last_run_at = startedAt;
    job.last_status = "ok";
    const base = {
      job_id: job.id,
      job_name: job.name,
      profile,
      session_id: sessionId,
      started_at: startedAt,
    };
    pushEvent({ kind: "cron.run.started", profile, job_id: job.id, run_id: run.id, payload: base });
    pushEvent({
      kind: "cron.run.finished",
      profile,
      job_id: job.id,
      run_id: run.id,
      payload: { ...base, status: "ok", ended_at: startedAt, result_text: run.result_text },
    });
    return { status: 202, body: { accepted: true } };
  }

  function instantiateBlueprint(profile: string, body: Record<string, unknown>): Reply {
    const state = cronFor(profile);
    const blueprint = state.blueprints.find((b) => b.key === body.blueprint);
    if (!blueprint) throw notFound("unknown_blueprint");
    const values =
      typeof body.values === "object" && body.values !== null
        ? (body.values as Record<string, unknown>)
        : {};
    const schedule = typeof values.time === "string" ? `daily at ${values.time}` : "daily";
    return createJob(profile, { schedule, prompt: blueprint.command, name: blueprint.title });
  }

  // ---- 아티팩트(0.8.0+) -----------------------------------------------------

  function nowEpochSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  function sha256Hex(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  function seedArtifact(input: {
    id: string;
    title: string;
    profile: string;
    board?: string | null;
    task_id?: string | null;
    kind?: ArtifactKind;
    mime?: string;
    filename?: string;
    body: string | Buffer;
    source_kind?: ArtifactSource;
  }): ArtifactSummary {
    const bytes = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : input.body;
    const now = nowEpochSeconds();
    const kind = input.kind ?? "document";
    const mime = input.mime ?? "text/markdown";
    const filename = input.filename ?? `${input.title}.md`;
    const sha256 = sha256Hex(bytes);
    const summary: ArtifactSummary = {
      id: input.id,
      kind,
      title: input.title,
      profile: input.profile,
      source_kind: input.source_kind ?? "chat",
      session_id: nextId("sess"),
      board: input.board ?? null,
      task_id: input.task_id ?? null,
      current_version: 1,
      filename,
      mime,
      size: bytes.length,
      sha256,
      created_at: now,
      updated_at: now,
    };
    const version: ArtifactVersion = {
      version: 1,
      filename,
      mime,
      size: bytes.length,
      sha256,
      created_by: input.profile,
      captured_via: "tool",
      created_at: now,
    };
    artifacts.set(input.id, { summary, versions: [{ meta: version, bytes }], deleted: false });
    return summary;
  }

  function artifactOf(id: string): ArtifactRecord {
    const record = artifacts.get(id);
    if (!record) throw notFound("artifact_not_found");
    if (record.deleted) throw new HttpError(410, { error: "artifact_deleted" });
    return record;
  }

  function listArtifacts(params: URLSearchParams): Reply {
    const profilesRaw = params.get("profiles");
    const profiles = profilesRaw ? profilesRaw.split(",").filter(Boolean) : [];
    const board = params.get("board") ?? undefined;
    const kind = params.get("kind") ?? undefined;
    const source = params.get("source") ?? undefined;
    const taskId = params.get("task_id") ?? undefined;
    const limitRaw = params.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isInteger(limit) || limit < 1) throw badRequest("invalid_limit");
    const cursorRaw = params.get("cursor");
    const start = cursorRaw ? Number(cursorRaw.replace(/^a/, "")) || 0 : 0;

    const all = [...artifacts.values()]
      .filter((r) => !r.deleted)
      .map((r) => r.summary)
      .filter((s) => {
        const inScope =
          (profiles.length > 0 && profiles.includes(s.profile)) ||
          (board !== undefined && s.board === board);
        if (!inScope) return false;
        if (kind !== undefined && s.kind !== kind) return false;
        if (source !== undefined && s.source_kind !== source) return false;
        if (taskId !== undefined && s.task_id !== taskId) return false;
        return true;
      })
      .sort((a, b) => b.updated_at - a.updated_at);

    const page = all.slice(start, start + limit);
    const hasMore = start + page.length < all.length;
    return {
      status: 200,
      body: { artifacts: page, cursor: `a${start + page.length}`, has_more: hasMore },
    };
  }

  function getArtifact(id: string): Reply {
    const record = artifactOf(id);
    return {
      status: 200,
      body: { artifact: record.summary, versions: record.versions.map((v) => v.meta) },
    };
  }

  function artifactContent(id: string, versionNum: number, req: ParsedRequest): Reply {
    const record = artifactOf(id);
    const versionRecord = record.versions.find((v) => v.meta.version === versionNum);
    if (!versionRecord) throw notFound("version_not_found");
    const bytes = versionRecord.bytes;
    const download = req.params.get("download") === "1";
    const disposition = `${download ? "attachment" : "inline"}; filename="${versionRecord.meta.filename}"`;
    const baseHeaders: Record<string, string> = {
      "content-type": versionRecord.meta.mime,
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
      "content-disposition": disposition,
    };
    const range = req.headers.range;
    const rangeMatch = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (rangeMatch) {
      const total = bytes.length;
      const startByte =
        rangeMatch[1] === "" ? total - Number(rangeMatch[2]) : Number(rangeMatch[1]);
      const endByte = rangeMatch[2] === "" ? total - 1 : Number(rangeMatch[2]);
      const slice = bytes.subarray(startByte, endByte + 1);
      return {
        status: 206,
        body: null,
        raw: {
          bytes: slice,
          headers: {
            ...baseHeaders,
            "content-range": `bytes ${startByte}-${endByte}/${total}`,
            "content-length": String(slice.length),
          },
        },
      };
    }
    return {
      status: 200,
      body: null,
      raw: { bytes, headers: { ...baseHeaders, "content-length": String(bytes.length) } },
    };
  }

  function addArtifactVersion(id: string, body: Record<string, unknown>): Reply {
    const record = artifactOf(id);
    if (typeof body.content !== "string" || typeof body.filename !== "string") {
      throw badRequest("invalid_body");
    }
    const bytes = Buffer.from(body.content, "utf8");
    const now = nowEpochSeconds();
    const nextVersion = record.summary.current_version + 1;
    const version: ArtifactVersion = {
      version: nextVersion,
      filename: body.filename,
      mime: record.summary.mime,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      created_by: record.summary.profile,
      captured_via: "tool",
      note: typeof body.note === "string" ? body.note : undefined,
      created_at: now,
    };
    record.versions.push({ meta: version, bytes });
    record.summary = {
      ...record.summary,
      current_version: nextVersion,
      filename: version.filename,
      size: version.size,
      sha256: version.sha256,
      updated_at: now,
    };
    return { status: 201, body: { version } };
  }

  function deleteArtifact(id: string): Reply {
    const record = artifactOf(id);
    record.deleted = true;
    return { status: 200, body: { ok: true } };
  }

  // ---- 라우팅 -------------------------------------------------------------

  function routeOwner(req: ParsedRequest): Reply {
    const { method, pathname, params, json } = req;
    const body = json;

    if (method === "GET" && pathname === "/deskrpg/info") return { status: 200, body: info };

    if (pathname === "/deskrpg/events") {
      if (method !== "GET") throw notFound();
      return pollEvents(params);
    }

    if (pathname === "/deskrpg/artifacts") {
      if (method !== "GET") throw notFound();
      return listArtifacts(params);
    }
    let artifactMatch = /^\/deskrpg\/artifacts\/([^/]+)$/.exec(pathname);
    if (artifactMatch) {
      const id = decodeURIComponent(artifactMatch[1]);
      if (method === "GET") return getArtifact(id);
      if (method === "DELETE") return deleteArtifact(id);
      throw notFound();
    }
    artifactMatch = /^\/deskrpg\/artifacts\/([^/]+)\/versions$/.exec(pathname);
    if (artifactMatch && method === "POST") {
      return addArtifactVersion(decodeURIComponent(artifactMatch[1]), body);
    }
    artifactMatch = /^\/deskrpg\/artifacts\/([^/]+)\/versions\/(\d+)\/content$/.exec(pathname);
    if (artifactMatch && method === "GET") {
      return artifactContent(decodeURIComponent(artifactMatch[1]), Number(artifactMatch[2]), req);
    }

    if (pathname === "/deskrpg/kanban/boards") {
      if (method === "GET") {
        return {
          status: 200,
          body: { boards: [...boards.values()].map(boardMeta), current: currentBoard },
        };
      }
      if (method === "POST") return createBoard(body);
      throw notFound();
    }
    let m = /^\/deskrpg\/kanban\/boards\/([^/]+)$/.exec(pathname);
    if (m && method === "PATCH") {
      const record = boards.get(decodeURIComponent(m[1]));
      if (!record) throw notFound("unknown_board");
      for (const key of ["name", "description", "default_workdir"] as const) {
        if (typeof body[key] === "string") record.meta[key] = body[key];
      }
      return { status: 200, body: { board: boardMeta(record) } };
    }

    if (pathname === "/deskrpg/kanban/orchestration") {
      if (method === "GET") return { status: 200, body: orchestration };
      if (method === "PUT") return updateOrchestration(body);
      throw notFound();
    }
    if (pathname === "/deskrpg/kanban/profiles" && method === "GET") {
      return {
        status: 200,
        body: {
          profiles: profileNames.map((name, i) => ({ name, is_default: i === 0, description: "" })),
        },
      };
    }

    // 아래는 전부 ?board= 를 요구한다.
    if (pathname === "/deskrpg/kanban/board" && method === "GET") {
      const board = boardOf(params);
      return { status: 200, body: renderBoard(board, params.get("include_archived") === "true") };
    }
    if (pathname === "/deskrpg/kanban/tasks" && method === "POST") {
      return createTask(boardOf(params), body);
    }
    if (pathname === "/deskrpg/kanban/dispatch" && method === "POST") {
      return dispatch(boardOf(params), params);
    }
    if (pathname === "/deskrpg/kanban/links") {
      if (method === "POST") return mutateLink(boardOf(params), body, true);
      if (method === "DELETE") return mutateLink(boardOf(params), body, false);
      throw notFound();
    }
    if (pathname === "/deskrpg/kanban/swarm" && method === "POST") {
      return createSwarm(boardOf(params), body);
    }
    m = /^\/deskrpg\/kanban\/tasks\/([^/]+)\/blackboard$/.exec(pathname);
    if (m && method === "GET") {
      return blackboardOf(boardOf(params), decodeURIComponent(m[1]));
    }
    m = /^\/deskrpg\/kanban\/attachments\/([^/]+)$/.exec(pathname);
    if (m) {
      const board = boardOf(params);
      const attachment = board.attachments.get(decodeURIComponent(m[1]));
      if (!attachment) throw notFound();
      if (method === "GET") return attachmentContent(attachment, req);
      if (method === "DELETE") {
        board.attachments.delete(attachment.id);
        return { status: 200, body: { ok: true } };
      }
      throw notFound();
    }
    m = /^\/deskrpg\/kanban\/tasks\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
    if (m) {
      const board = boardOf(params);
      const id = decodeURIComponent(m[1]);
      const sub = m[2];
      if (sub === undefined) {
        if (method === "GET") return { status: 200, body: detailOf(board, id) };
        if (method === "PATCH") return updateTask(board, id, body);
        if (method === "DELETE") return deleteTask(board, id);
        throw notFound();
      }
      if (sub === "comments" && method === "POST") return addComment(board, id, body);
      if (sub === "log" && method === "GET") return taskLog(board, id, params);
      if (sub === "attachments") {
        if (method === "GET") {
          const detail = detailOf(board, id);
          return { status: 200, body: { attachments: detail.attachments ?? [] } };
        }
        if (method === "POST") return uploadAttachment(board, id, req);
        throw notFound();
      }
      if (method === "POST") return runTaskAction(board, id, sub, body);
    }
    throw notFound();
  }

  function routeProfile(profile: string, req: ParsedRequest): Reply {
    const { method, pathname, params, json } = req;
    const state = cronFor(profile);
    const rest = pathname.replace(/^\/deskrpg\/cron/, "");
    if (rest === pathname) throw notFound();

    if (rest === "/jobs") {
      if (method === "GET") {
        const includeDisabled = params.get("include_disabled") === "true";
        return {
          status: 200,
          body: { jobs: [...state.jobs.values()].filter((j) => includeDisabled || j.enabled) },
        };
      }
      if (method === "POST") return createJob(profile, json);
      throw notFound();
    }
    if (rest === "/delivery-targets" && method === "GET") {
      return { status: 200, body: { targets: state.deliveryTargets } };
    }
    if (rest === "/blueprints" && method === "GET") {
      return { status: 200, body: { blueprints: state.blueprints } };
    }
    if (rest === "/blueprints/instantiate" && method === "POST") {
      return instantiateBlueprint(profile, json);
    }
    const m = /^\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(rest);
    if (!m) throw notFound();
    const id = decodeURIComponent(m[1]);
    const sub = m[2];
    if (sub === undefined) {
      if (method === "GET") return { status: 200, body: { job: jobOf(state, id) } };
      if (method === "PUT") return updateJob(state, id, json);
      if (method === "DELETE") {
        jobOf(state, id);
        state.jobs.delete(id);
        state.runs.delete(id);
        return { status: 200, body: { ok: true } };
      }
      throw notFound();
    }
    if (sub === "runs" && method === "GET") {
      jobOf(state, id);
      const limitRaw = params.get("limit");
      const limit = limitRaw ? Number(limitRaw) : 20;
      return { status: 200, body: { runs: (state.runs.get(id) ?? []).slice(0, limit) } };
    }
    if (method !== "POST") throw notFound();
    if (sub === "pause") {
      const job = jobOf(state, id);
      job.enabled = false;
      job.state = "paused";
      job.next_run_at = null;
      return { status: 200, body: { job } };
    }
    if (sub === "resume") {
      const job = jobOf(state, id);
      job.enabled = true;
      job.state = "scheduled";
      job.next_run_at = nowIso();
      return { status: 200, body: { job } };
    }
    if (sub === "run") return runJob(profile, state, id);
    throw notFound();
  }

  function authFailure(): HttpError {
    // Hermes 실측 모양(plugin-errors.ts 모듈 주석) — code 는 객체 안에 있다.
    return new HttpError(401, {
      error: {
        message: "Invalid gateway API key (API_SERVER_KEY)",
        type: "gateway_auth_error",
        code: "gateway_auth_failed",
      },
    });
  }

  function handle(req: ParsedRequest): Reply {
    const profileMatch = /^\/p\/([^/]+)(\/.*)$/.exec(req.pathname);
    if (profileMatch) {
      const profile = decodeURIComponent(profileMatch[1]);
      const token = options.profileTokens[profile];
      if (token === undefined)
        throw new HttpError(404, { error: "Unknown or unconfigured profile" });
      if (req.auth !== `Bearer ${token}`) throw authFailure();
      return routeProfile(profile, { ...req, pathname: profileMatch[2] });
    }
    if (req.auth !== `Bearer ${options.ownerToken}`) throw authFailure();
    return routeOwner(req);
  }

  const server = http.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(incoming.url ?? "/", "http://fake");
      const contentType = incoming.headers["content-type"] ?? null;
      let json: Record<string, unknown> = {};
      if (raw.length > 0 && contentType?.startsWith("application/json")) {
        try {
          const parsed = JSON.parse(raw.toString("utf8"));
          if (typeof parsed === "object" && parsed !== null) json = parsed;
        } catch {
          json = {};
        }
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
      const parsed: ParsedRequest = {
        method: incoming.method ?? "GET",
        pathname: url.pathname,
        params: url.searchParams,
        auth: incoming.headers.authorization ?? null,
        contentType,
        json,
        raw,
        headers,
      };

      let reply: Reply;
      try {
        reply = handle(parsed);
      } catch (err) {
        reply =
          err instanceof HttpError
            ? { status: err.status, body: err.body }
            : { status: 500, body: { error: "internal_error", detail: String(err) } };
      }
      recorded.push({
        method: parsed.method,
        path: url.pathname + url.search,
        auth: parsed.auth,
        contentType,
        json: raw.length > 0 && contentType?.startsWith("application/json") ? json : null,
        status: reply.status,
        headers,
      });
      if (reply.raw) {
        outgoing.writeHead(reply.status, reply.raw.headers);
        outgoing.end(reply.raw.bytes);
      } else {
        const payload = JSON.stringify(reply.body);
        outgoing.writeHead(reply.status, { "content-type": "application/json" });
        outgoing.end(payload);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    reset,
    setInfo: (patch) => {
      info = { ...info, ...patch, plugin: "deskrpg" };
    },
    lastRequest: () => recorded[recorded.length - 1] ?? null,
    requests: () => [...recorded],
    pushEvent,
    setTaskLog: (slug, taskId, content) => {
      const board = boards.get(slug);
      if (!board) throw new Error(`unknown board: ${slug}`);
      board.logs.set(taskId, content);
    },
    setDeliveryTargets: (profile, targets) => {
      cronFor(profile).deliveryTargets = targets;
    },
    setBlueprints: (profile, blueprints) => {
      cronFor(profile).blueprints = blueprints;
    },
    seedArtifact,
    seedAttachment,
  };
}

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

type ParsedRequest = {
  method: string;
  pathname: string;
  params: URLSearchParams;
  auth: string | null;
  contentType: string | null;
  json: Record<string, unknown>;
  raw: Buffer;
  /** 소문자 키로 정규화한 요청 헤더 전부. */
  headers: Record<string, string>;
};

function defaultOrchestration(profileNames: string[]): OrchestrationSettings {
  return {
    orchestrator_profile: null,
    default_assignee: null,
    auto_decompose: false,
    resolved_orchestrator_profile: profileNames[0] ?? null,
    resolved_default_assignee: profileNames[0] ?? null,
    max_in_progress: 8,
    max_in_progress_per_profile: 2,
  };
}

function isTaskStatus(value: unknown): value is KanbanTaskStatus {
  return typeof value === "string" && (KANBAN_TASK_STATUSES as readonly string[]).includes(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `body` 에서 문자열 값만 골라 낸다 — 카드 필드는 전부 문자열이라 이것으로 충분하다. */
function pick(body: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * multipart/form-data 에서 첫 파일 파트의 filename 과 크기만 뽑는다. 첨부 업로드
 * 왕복(경로·content-type·파일명·크기)을 고정하는 데 필요한 만큼만 파싱한다.
 */
function parseMultipartFile(
  contentType: string | null,
  raw: Buffer,
): { filename: string; size: number; content: Buffer } | null {
  const boundaryMatch = /boundary=("?)([^";]+)\1/.exec(contentType ?? "");
  if (!boundaryMatch) return null;
  const delimiter = Buffer.from(`--${boundaryMatch[2]}`);
  let cursor = raw.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    // 닫는 구분자(`--boundary--`)면 끝.
    if (raw.slice(partStart, partStart + 2).toString() === "--") break;
    const next = raw.indexOf(delimiter, partStart);
    const partEnd = next === -1 ? raw.length : next;
    const part = raw.slice(partStart, partEnd);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const filenameMatch = /filename="([^"]*)"/.exec(headers);
      if (filenameMatch) {
        // 본문은 헤더 뒤 CRLF 두 개 다음부터, 다음 구분자 앞의 CRLF 전까지.
        let content = part.slice(headerEnd + 4);
        if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
        return { filename: filenameMatch[1], size: content.length, content };
      }
    }
    cursor = next;
  }
  return null;
}
