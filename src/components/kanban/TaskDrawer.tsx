"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";

import { useLocale, useT } from "@/lib/i18n";
import {
  KANBAN_TASK_STATUSES,
  type KanbanTask,
  type KanbanTaskAction,
  type KanbanTaskDetail,
  type KanbanTaskStatus,
  type WorkerLog,
  type ArtifactSummary,
} from "@/lib/hermes/deskrpg-plugin-types";

import { KindIcon } from "../artifacts/ArtifactList";
import { ArtifactsApiError } from "../artifacts/artifacts-api";

import { toFailure, type KanbanApi } from "./kanban-api";
import {
  activeAssigneeOptions,
  assigneeLabel,
  failureLine,
  npcIdForAssignee,
  splitBlackboardComments,
  taskTitleById,
  type BoardNpc,
} from "./kanban-view-model";

/** 카드의 결과물 섹션이 쓰는 것. 배선(GamePageClient)이 채널 결과물 API 로 채운다. */
export type TaskDrawerArtifacts = {
  list(taskId: string): Promise<ArtifactSummary[]>;
  open(artifactId: string): void;
};

interface TaskDrawerProps {
  api: KanbanApi;
  taskId: string;
  npcs: readonly BoardNpc[];
  /** 보드의 카드 전부 — 링크 이름·선행 카드 선택지. */
  boardTasks: readonly KanbanTask[];
  /** `automation/status.attachments`. false 면 첨부 섹션을 숨긴다(R12). */
  attachmentsSupported: boolean;
  /** 생성 응답의 `warning`(디스패처 없음) — 이 카드에 한해 상단에 띄운다(R9). */
  creationWarning: string | null;
  /** 바뀌면 상세를 다시 읽는다(`kanban:event`, 보드 재조회). */
  refreshTick: number;
  /** 조작이 성공했다 — 보드를 다시 읽으라는 신호(R26). */
  onChanged: () => void;
  onEdit: (task: KanbanTask) => void;
  onDeleted: () => void;
  onClose: () => void;
  /** 카드의 결과물 — null·미지정이면 섹션을 숨긴다. 플러그인이 0.8.4 미만(428)이어도 숨긴다. */
  artifacts?: TaskDrawerArtifacts | null;
}

const BTN = "px-2.5 py-1 rounded-md text-[11px] font-semibold disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary hover:bg-primary-hover text-white`;
const BTN_SOFT = `${BTN} bg-surface-raised hover:brightness-125 text-text-secondary`;
const BTN_DANGER = `${BTN} bg-danger-bg hover:bg-danger-hover text-danger`;
const FIELD = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text";

const LOG_TAIL = 16384;

type Pending = KanbanTaskAction | "status" | "comment" | "link" | "attachment" | "delete" | null;

/**
 * 카드 상세 드로어. 모든 조작은 서버 → 성공 → 재조회(R26)이며, 액션의 허용 여부는 서버가
 * 강제한다(R10) — 여기서는 상태에 맞는 버튼을 앞에 두는 것뿐, 숨기지 않는다.
 */
export default function TaskDrawer({
  api,
  taskId,
  npcs,
  boardTasks,
  attachmentsSupported,
  creationWarning,
  refreshTick,
  onChanged,
  onEdit,
  onDeleted,
  onClose,
  artifacts = null,
}: TaskDrawerProps) {
  const t = useT();
  const { locale } = useLocale();
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [comment, setComment] = useState("");
  const [changesComment, setChangesComment] = useState("");
  const [unblockComment, setUnblockComment] = useState("");
  const [reassignNpcId, setReassignNpcId] = useState("");
  const [linkParentId, setLinkParentId] = useState("");
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<WorkerLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // 결과물 섹션 — null 은 읽는 중, "hidden" 은 428(taskId 필터 미지원)이라 섹션을 숨긴다.
  const [cardArtifacts, setCardArtifacts] = useState<ArtifactSummary[] | "hidden" | null>(null);
  const [cardArtifactsError, setCardArtifactsError] = useState(false);

  const {
    comments: threadComments,
    blackboard,
    authors,
  } = useMemo(() => splitBlackboardComments(detail?.comments ?? []), [detail?.comments]);
  const blackboardKeys = Object.keys(blackboard).filter((key) => key !== "_authors");

  const load = useCallback(async () => {
    try {
      const data = await api.taskDetail(taskId);
      setDetail(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(failureLine(toFailure(err)));
    }
  }, [api, taskId]);

  const loadLog = useCallback(async () => {
    try {
      setLog(await api.log(taskId, LOG_TAIL));
      setLogError(null);
    } catch (err) {
      setLogError(failureLine(toFailure(err)));
    }
  }, [api, taskId]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  useEffect(() => {
    if (!artifacts) return;
    let cancelled = false;
    artifacts.list(taskId).then(
      (items) => {
        if (cancelled) return;
        setCardArtifacts(items);
        setCardArtifactsError(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ArtifactsApiError && err.status === 428) setCardArtifacts("hidden");
        else setCardArtifactsError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [artifacts, taskId, refreshTick]);

  useEffect(() => {
    if (showLog) void loadLog();
  }, [showLog, loadLog, refreshTick]);

  useEffect(() => {
    setEstimate(null);
    setShowLog(false);
    setLog(null);
  }, [taskId]);

  useEffect(() => {
    if (detail) setReassignNpcId(npcIdForAssignee(detail.task.assignee, npcs) ?? "");
  }, [detail, npcs]);

  /** 조작 공통 — 성공하면 상세·보드를 다시 읽는다. 실패 메시지는 코드·메시지 그대로. */
  const run = async (kind: Exclude<Pending, null>, fn: () => Promise<unknown>) => {
    setPending(kind);
    setActionError(null);
    try {
      const result = await fn();
      await load();
      onChanged();
      return result;
    } catch (err) {
      setActionError(failureLine(toFailure(err)));
      return null;
    } finally {
      setPending(null);
    }
  };

  const act = (action: KanbanTaskAction, body?: Record<string, unknown>) =>
    run(action, () => api.action(taskId, action, body));

  const task = detail?.task ?? null;
  const status = task?.status;
  const assignees = activeAssigneeOptions(npcs);
  const linkCandidates = boardTasks.filter(
    (candidate) => candidate.id !== taskId && !(detail?.links.parents ?? []).includes(candidate.id),
  );
  const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale) : "");

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm(t("kanban.action.deleteConfirm", { title: task.title }))) return;
    setPending("delete");
    setActionError(null);
    try {
      await api.deleteTask(taskId);
      onChanged();
      onDeleted();
    } catch (err) {
      setActionError(failureLine(toFailure(err)));
    } finally {
      setPending(null);
    }
  };

  const handleStatus = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as KanbanTaskStatus;
    if (!next || next === status) return;
    void run("status", () => api.updateTask(taskId, { status: next }));
  };

  const handleComment = async () => {
    const body = comment.trim();
    if (!body) return;
    const ok = await run("comment", () => api.addComment(taskId, body));
    if (ok) setComment("");
  };

  const handleEstimate = async () => {
    const result = (await act("estimate")) as { task?: unknown } | null;
    if (result) setEstimate(result as Record<string, unknown>);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run("attachment", () => api.uploadAttachment(taskId, file));
  };

  return (
    <aside
      aria-label={t("kanban.detail.title")}
      className="flex h-full w-full sm:w-[420px] flex-shrink-0 flex-col border-l border-border bg-bg text-xs"
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="font-bold text-sm text-text break-words">
            {task?.title ?? t("common.loading")}
          </div>
          {task && (
            <div className="mt-0.5 text-[11px] text-text-muted">
              {assigneeLabel(task.assignee, npcs) ?? t("kanban.card.unassigned")}
              {task.created_by ? ` · ${t("kanban.detail.createdBy")}: ${task.created_by}` : ""}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {task && (
            <button
              type="button"
              onClick={() => onEdit(task)}
              aria-label={t("kanban.detail.edit")}
              title={t("kanban.detail.edit")}
              className="text-text-muted hover:text-text p-1"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-text-muted hover:text-text p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {creationWarning && (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-700">
            {creationWarning}
          </div>
        )}
        {loadError && (
          <div role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-danger">
            {loadError}
          </div>
        )}

        {detail && task && (
          <>
            {/* 상태 + 액션 (R10·R13) */}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <label
                  className="text-[11px] font-semibold text-text-secondary"
                  htmlFor="kanban-status"
                >
                  {t("kanban.detail.status")}
                </label>
                <select
                  id="kanban-status"
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={status}
                  disabled={pending !== null}
                  onChange={handleStatus}
                >
                  {KANBAN_TASK_STATUSES.map((name) => (
                    <option key={name} value={name}>
                      {t(`kanban.column.${name}`)}
                    </option>
                  ))}
                </select>
              </div>

              {status === "review" && (
                <div className="space-y-1.5 rounded-md border border-border p-2">
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={pending !== null}
                    onClick={() => void act("approve")}
                  >
                    {t("kanban.action.approve")}
                  </button>
                  <textarea
                    className={`${FIELD} min-h-[56px]`}
                    placeholder={t("kanban.action.requestChangesComment")}
                    value={changesComment}
                    onChange={(e) => setChangesComment(e.target.value)}
                  />
                  <button
                    type="button"
                    className={BTN_SOFT}
                    disabled={pending !== null || !changesComment.trim()}
                    onClick={() =>
                      void act("request-changes", { comment: changesComment.trim() }).then((ok) => {
                        if (ok) setChangesComment("");
                      })
                    }
                  >
                    {t("kanban.action.requestChanges")}
                  </button>
                </div>
              )}

              {status === "blocked" && (
                <div className="space-y-1.5 rounded-md border border-border p-2">
                  <textarea
                    className={`${FIELD} min-h-[48px]`}
                    placeholder={t("kanban.action.unblockComment")}
                    value={unblockComment}
                    onChange={(e) => setUnblockComment(e.target.value)}
                  />
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={pending !== null}
                    onClick={() =>
                      void act(
                        "unblock",
                        unblockComment.trim() ? { comment: unblockComment.trim() } : {},
                      ).then((ok) => {
                        if (ok) setUnblockComment("");
                      })
                    }
                  >
                    {t("kanban.action.unblock")}
                  </button>
                </div>
              )}

              {status === "running" && (
                <button
                  type="button"
                  className={BTN_DANGER}
                  disabled={pending !== null}
                  onClick={() => void act("terminate")}
                >
                  {t("kanban.action.terminate")}
                </button>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label={t("kanban.action.reassign")}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={reassignNpcId}
                  disabled={pending !== null}
                  onChange={(e) => setReassignNpcId(e.target.value)}
                >
                  <option value="">{t("kanban.form.assigneeNone")}</option>
                  {assignees.map((npc) => (
                    <option key={npc.npcId} value={npc.npcId}>
                      {npc.npcName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null || !reassignNpcId}
                  onClick={() => void act("reassign", { npcId: reassignNpcId })}
                >
                  {t("kanban.action.reassign")}
                </button>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null}
                  onClick={() => void act("reclaim")}
                >
                  {t("kanban.action.reclaim")}
                </button>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null}
                  onClick={() => void act("archive")}
                >
                  {t("kanban.action.archive")}
                </button>
                <button
                  type="button"
                  className={BTN_DANGER}
                  disabled={pending !== null}
                  onClick={() => void handleDelete()}
                >
                  {t("kanban.action.delete")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null}
                  onClick={() => void act("decompose")}
                >
                  {t("kanban.action.decompose")}
                </button>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null}
                  onClick={() => void act("specify")}
                >
                  {t("kanban.action.specify")}
                </button>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null}
                  onClick={() => void handleEstimate()}
                >
                  {t("kanban.action.estimate")}
                </button>
              </div>

              {estimate && (
                <div className="rounded-md bg-surface p-2">
                  <div className="font-semibold text-text-secondary mb-1">
                    {t("kanban.action.estimateResult")}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] text-text-secondary">
                    {JSON.stringify(estimate, null, 2)}
                  </pre>
                </div>
              )}

              {actionError && (
                <div
                  role="alert"
                  className="rounded-md bg-danger-bg px-3 py-2 text-danger break-words"
                >
                  {actionError}
                </div>
              )}
            </section>

            <Section title={t("kanban.detail.description")}>
              {task.body ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-text-secondary">
                  {task.body}
                </pre>
              ) : (
                <Empty>{t("kanban.detail.noDescription")}</Empty>
              )}
            </Section>

            <Section title={t("kanban.detail.result")}>
              {task.result ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-text-secondary">
                  {task.result}
                </pre>
              ) : (
                <Empty>{t("kanban.detail.noResult")}</Empty>
              )}
              {task.last_failure_error && (
                <div className="mt-2 rounded-md bg-danger-bg px-2 py-1.5 text-danger break-words">
                  {t("kanban.detail.lastFailure")}: {task.last_failure_error}
                </div>
              )}
            </Section>

            {task.diagnostics && task.diagnostics.length > 0 && (
              <Section title={t("kanban.detail.diagnostics")}>
                <ul className="space-y-1.5">
                  {task.diagnostics.map((diag, index) => (
                    <li
                      key={`${diag.kind}-${index}`}
                      className="rounded-md border border-border p-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1 text-[10px] ${
                            diag.severity === "warning"
                              ? "bg-amber-500/15 text-amber-700"
                              : "bg-danger-bg text-danger"
                          }`}
                        >
                          {diag.severity}
                        </span>
                        <span className="font-semibold text-text">{diag.title}</span>
                        {diag.count > 1 && <span className="text-text-dim">×{diag.count}</span>}
                      </div>
                      <div className="mt-1 text-text-secondary break-words">{diag.detail}</div>
                      {diag.actions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {diag.actions.map((action) => (
                            <span
                              key={action.kind}
                              className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-secondary"
                            >
                              {action.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={t("kanban.detail.links")}>
              <LinkList
                label={t("kanban.detail.parents")}
                ids={detail.links.parents}
                boardTasks={boardTasks}
                disabled={pending !== null}
                onRemove={(parentId) => void run("link", () => api.removeLink(parentId, taskId))}
              />
              <LinkList
                label={t("kanban.detail.children")}
                ids={detail.links.children}
                boardTasks={boardTasks}
                disabled={pending !== null}
                onRemove={(childId) => void run("link", () => api.removeLink(taskId, childId))}
              />
              {task.progress && task.progress.total > 0 && (
                <div className="text-text-dim">
                  {t("kanban.card.progress", {
                    value: `${task.progress.done}/${task.progress.total}`,
                  })}
                </div>
              )}
              <div className="mt-1 flex items-center gap-1.5">
                <select
                  aria-label={t("kanban.detail.addLink")}
                  className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={linkParentId}
                  disabled={pending !== null}
                  onChange={(e) => setLinkParentId(e.target.value)}
                >
                  <option value="">{t("kanban.detail.addLink")}</option>
                  {linkCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={BTN_SOFT}
                  disabled={pending !== null || !linkParentId}
                  onClick={() =>
                    void run("link", () => api.addLink(linkParentId, taskId)).then((ok) => {
                      if (ok) setLinkParentId("");
                    })
                  }
                >
                  {t("common.create")}
                </button>
              </div>
            </Section>

            {blackboardKeys.length > 0 ? (
              <Section title={t("kanban.blackboard")}>
                <dl className="space-y-1">
                  {blackboardKeys.map((key) => (
                    <div key={key} className="rounded-md bg-surface-raised px-2 py-1.5">
                      <dt className="flex items-baseline justify-between text-[10px] text-text-dim">
                        <span className="font-semibold text-text-secondary">{key}</span>
                        {authors[key] ? <span>{authors[key]}</span> : null}
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] text-text">
                        {typeof blackboard[key] === "string"
                          ? (blackboard[key] as string)
                          : JSON.stringify(blackboard[key], null, 2)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Section>
            ) : null}

            <Section title={`${t("kanban.detail.comments")} (${threadComments.length})`}>
              {threadComments.length === 0 ? (
                <Empty>{t("kanban.detail.noComments")}</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {threadComments.map((entry) => (
                    <li key={entry.id} className="rounded-md bg-surface p-2">
                      <div className="flex items-center justify-between text-[10px] text-text-dim">
                        <span className="font-semibold text-text-secondary">{entry.author}</span>
                        <span>{formatDate(entry.created_at)}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-text">
                        {entry.body}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-end gap-1.5">
                <textarea
                  aria-label={t("kanban.detail.comments")}
                  className={`${FIELD} min-h-[56px]`}
                  placeholder={t("kanban.detail.commentPlaceholder")}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={pending !== null || !comment.trim()}
                  onClick={() => void handleComment()}
                >
                  {t("common.send")}
                </button>
              </div>
            </Section>

            <Section title={t("kanban.detail.runs")}>
              {detail.runs.length === 0 ? (
                <Empty>{t("kanban.detail.noRuns")}</Empty>
              ) : (
                <ul className="space-y-1">
                  {detail.runs.map((entry) => (
                    <li key={entry.id} className="rounded-md bg-surface p-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-dim">
                        <span className="font-semibold text-text-secondary">{entry.status}</span>
                        {entry.outcome && <span>{entry.outcome}</span>}
                        {entry.profile && <span>{entry.profile}</span>}
                        <span>{formatDate(entry.started_at)}</span>
                        {entry.ended_at && <span>→ {formatDate(entry.ended_at)}</span>}
                      </div>
                      {entry.summary && (
                        <div className="mt-1 text-text-secondary break-words">{entry.summary}</div>
                      )}
                      {entry.error && (
                        <div className="mt-1 text-danger break-words">{entry.error}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <section>
              <button
                type="button"
                onClick={() => setShowLog((prev) => !prev)}
                className="flex items-center gap-1 font-bold text-text-secondary mb-1.5"
              >
                {showLog ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                {t("kanban.detail.log")}
              </button>
              {showLog &&
                (logError ? (
                  <div className="text-danger">{logError}</div>
                ) : !log ? (
                  <Empty>{t("common.loading")}</Empty>
                ) : !log.exists || !log.content ? (
                  <Empty>{t("kanban.detail.logEmpty")}</Empty>
                ) : (
                  <div>
                    {log.truncated && (
                      <div className="text-[10px] text-text-dim mb-1">
                        {t("kanban.detail.logTruncated")}
                      </div>
                    )}
                    <pre className="max-h-[260px] overflow-auto rounded-md bg-bg-deep p-2 text-[10px] leading-snug text-text-secondary whitespace-pre-wrap break-words">
                      {log.content}
                    </pre>
                  </div>
                ))}
            </section>

            {attachmentsSupported && detail.attachments !== null && (
              <Section title={t("kanban.detail.attachments")}>
                {detail.attachments.length === 0 ? (
                  <Empty>{t("kanban.detail.noAttachments")}</Empty>
                ) : (
                  <ul className="space-y-1">
                    {detail.attachments.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center justify-between gap-2 rounded-md bg-surface px-2 py-1"
                      >
                        <a
                          href={api.attachmentUrl(file.id)}
                          download={file.filename}
                          className="truncate text-text hover:underline"
                        >
                          {file.filename}
                        </a>
                        <span className="text-[10px] text-text-dim">
                          {typeof file.size === "number" ? `${file.size} B` : ""}
                        </span>
                        <button
                          type="button"
                          className="text-[10px] text-danger hover:underline"
                          disabled={pending !== null}
                          onClick={() =>
                            void run("attachment", () => api.deleteAttachment(file.id))
                          }
                        >
                          {t("common.delete")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  onChange={(e) => void handleUpload(e)}
                />
                <button
                  type="button"
                  className={`${BTN_SOFT} mt-2`}
                  disabled={pending !== null}
                  onClick={() => fileInput.current?.click()}
                >
                  {t("kanban.detail.upload")}
                </button>
              </Section>
            )}

            {artifacts && cardArtifacts !== "hidden" && (
              <Section title={t("artifacts.card.title")}>
                {cardArtifactsError && cardArtifacts === null ? (
                  <div className="text-danger">{t("artifacts.error")}</div>
                ) : cardArtifacts === null ? (
                  <Empty>{t("common.loading")}</Empty>
                ) : cardArtifacts.length === 0 ? (
                  <Empty>{t("artifacts.card.empty")}</Empty>
                ) : (
                  <ul className="space-y-1">
                    {cardArtifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md bg-surface px-2 py-1 text-left text-text hover:brightness-125"
                          onClick={() => artifacts.open(artifact.id)}
                        >
                          <KindIcon artifact={artifact} />
                          <span className="truncate">{artifact.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            <Section title={t("kanban.detail.runSettings")}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-secondary">
                <dt className="text-text-dim">{t("kanban.detail.workspace")}</dt>
                <dd className="break-all">
                  {[task.workspace_kind, task.workspace_path].filter(Boolean).join(" · ") || "—"}
                </dd>
                <dt className="text-text-dim">{t("kanban.detail.model")}</dt>
                <dd>{task.model_override || "—"}</dd>
                <dt className="text-text-dim">{t("kanban.detail.provider")}</dt>
                <dd>{task.provider_override || "—"}</dd>
                <dt className="text-text-dim">{t("kanban.detail.reasoning")}</dt>
                <dd>{task.reasoning_effort || "—"}</dd>
                <dt className="text-text-dim">{t("kanban.detail.branch")}</dt>
                <dd className="break-all">{task.branch_name || "—"}</dd>
              </dl>
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="font-bold text-text-secondary mb-1.5">{title}</div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-text-dim">{children}</div>;
}

function LinkList({
  label,
  ids,
  boardTasks,
  disabled,
  onRemove,
}: {
  label: string;
  ids: string[];
  boardTasks: readonly KanbanTask[];
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="mb-1.5">
      <div className="text-[10px] text-text-dim">
        {label} ({ids.length})
      </div>
      {ids.length > 0 && (
        <ul className="space-y-0.5">
          {ids.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1"
            >
              <span className="truncate text-text">{taskTitleById(boardTasks, id)}</span>
              <button
                type="button"
                className="text-[10px] text-danger hover:underline flex-shrink-0"
                disabled={disabled}
                onClick={() => onRemove(id)}
              >
                {t("kanban.detail.removeLink")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
