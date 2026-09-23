"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { SkillDetail } from "@/lib/hermes/plugin-client-types";

import { skillErrorText } from "./skill-error-text";
import { SkillsApiError, type SkillsApi } from "./skills-api";

export type SkillDetailPaneProps = {
  api: SkillsApi;
  name: string;
  canManage: boolean;
  onChanged(): void;
  /** 보관·삭제로 이 스킬이 목록에서 빠졌다 — 부모가 선택을 비운다. */
  onRemoved?(): void;
};

type Confirm = "archive" | "uninstall" | null;

/** 잠긴 파일의 사유 — 실행 코드(`scripts/`·`assets/`)인지, 원산지 때문에 읽기 전용인지. */
const lockReason = (path: string) =>
  path.startsWith("scripts/") || path.startsWith("assets/")
    ? "skills.file.locked"
    : "skills.file.readOnly";

/**
 * 스킬 한 개의 상세 — 원산지·자동 정리 여부, 파일 트리(잠금 표시), 편집기, 고정·보관·삭제.
 * 저장은 읽을 때 받은 해시를 `baseHash` 로 싣고, 409 `skill_changed` 면 편집 내용을 그대로 둔 채 다시 불러오기를 권한다.
 */
export default function SkillDetailPane({
  api,
  name,
  canManage,
  onChanged,
  onRemoved,
}: SkillDetailPaneProps) {
  const t = useT();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [path, setPath] = useState("SKILL.md");
  const [text, setText] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // 파일을 빠르게 바꿔 누를 때 늦게 온 옛 파일이 편집기를 덮지 않게 한다.
  const fileSeq = useRef(0);

  const loadFile = useCallback(
    async (p: string) => {
      const seq = ++fileSeq.current;
      try {
        const f = await api.readFile(name, p);
        if (seq !== fileSeq.current) return;
        setPath(p);
        setText(f.content);
        setHash(f.hash);
        setConflict(false);
        setError(null);
        setSaved(false);
      } catch (e) {
        if (seq === fileSeq.current) setError(skillErrorText(t, e));
      }
    },
    [api, name, t],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.detail(name);
        if (!alive) return;
        setDetail(d);
        await loadFile("SKILL.md");
      } catch (e) {
        if (alive) setError(skillErrorText(t, e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, name, loadFile, t]);

  if (!detail) {
    return error ? <p className="p-3 text-xs text-danger">{error}</p> : null;
  }
  const current = detail.files.find((f) => f.path === path);
  const editable = canManage && Boolean(current?.editable);
  const isLocal = detail.skill.source === "local";
  const isHub = detail.skill.source === "hub";

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(skillErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      setSaved(false);
      try {
        const res = await api.writeFile(name, path, text, hash);
        setHash(res.hash);
        setConflict(false);
        setSaved(true);
        onChanged();
      } catch (e) {
        if (e instanceof SkillsApiError && e.code === "skill_changed") setConflict(true);
        else throw e;
      }
    });
  const pin = () =>
    run(async () => {
      await api.setPinned(name, !detail.skill.pinned);
      setDetail(await api.detail(name));
      onChanged();
    });
  const archive = () =>
    run(async () => {
      await api.archive(name);
      setConfirm(null);
      onChanged();
      onRemoved?.();
    });
  const uninstall = () =>
    run(async () => {
      await api.hubUninstall(name);
      setConfirm(null);
      onChanged();
      onRemoved?.();
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-sm">
      <div className="text-text">
        <strong>{name}</strong>{" "}
        <span className="text-xs text-text-muted">
          {t(`skills.source.${detail.skill.source}`)} ·{" "}
          {t(
            detail.skill.curatorManaged ? "skills.curatorManaged.yes" : "skills.curatorManaged.no",
          )}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {detail.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              data-file={f.path}
              data-locked={String(!f.editable)}
              onClick={() => void loadFile(f.path)}
              title={f.editable ? undefined : t(lockReason(f.path))}
              className={`flex items-center gap-1 ${
                f.path === path ? "text-primary" : "text-text-muted"
              } hover:text-text`}
            >
              {f.path}
              {!f.editable && <Lock className="h-3 w-3" aria-label={t(lockReason(f.path))} />}
            </button>
          </li>
        ))}
      </ul>
      {conflict && (
        <div className="rounded border border-border p-2 text-xs text-text">
          {t("skills.conflict")}{" "}
          <button
            type="button"
            data-action="reload"
            className="text-primary"
            onClick={() => void loadFile(path)}
          >
            {t("skills.reload")}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {canManage && current && !current.editable && (
        <p className="text-[11px] text-text-dim">{t(lockReason(current.path))}</p>
      )}
      <textarea
        value={text}
        readOnly={!editable}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        aria-label={path}
        className="min-h-0 flex-1 rounded border border-border bg-surface-raised p-2 font-mono text-xs text-text"
      />
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <button
              type="button"
              data-action="save"
              disabled={busy}
              onClick={() => void save()}
              className="rounded bg-primary px-3 py-1 text-white disabled:opacity-50"
            >
              {t("skills.save")}
            </button>
          )}
          {saved && <span className="text-xs text-text-muted">{t("skills.saved")}</span>}
          {isLocal && (
            <>
              <button
                type="button"
                data-action="pin"
                disabled={busy}
                onClick={() => void pin()}
                className="rounded px-3 py-1 text-text hover:bg-surface-raised disabled:opacity-50"
              >
                {t(detail.skill.pinned ? "skills.unpin" : "skills.pin")}
              </button>
              <button
                type="button"
                data-action="archive"
                disabled={busy}
                onClick={() => setConfirm("archive")}
                className="rounded px-3 py-1 text-danger hover:bg-surface-raised disabled:opacity-50"
              >
                {t("skills.archive")}
              </button>
            </>
          )}
          {isHub && (
            <button
              type="button"
              data-action="uninstall"
              disabled={busy}
              onClick={() => setConfirm("uninstall")}
              className="rounded px-3 py-1 text-danger hover:bg-surface-raised disabled:opacity-50"
            >
              {t("skills.uninstall")}
            </button>
          )}
        </div>
      )}
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
          <span className="text-text">
            {t(confirm === "archive" ? "skills.archive.confirm" : "skills.uninstall.confirm")}
          </span>
          <button
            type="button"
            data-action={confirm === "archive" ? "confirm-archive" : "confirm-uninstall"}
            disabled={busy}
            onClick={() => void (confirm === "archive" ? archive() : uninstall())}
            className="text-danger disabled:opacity-50"
          >
            {t("common.confirm")}
          </button>
          <button type="button" onClick={() => setConfirm(null)} className="text-text-muted">
            {t("common.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
