"use client";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";

import { safeHttpUrl } from "./artifact-view-model";

export type ArtifactEditorProps = {
  initial: string;
  filename: string;
  isLink: boolean;
  onSave(content: string, note: string): Promise<void>;
  onCancel(): void;
};

/** CodeMirror 6 `EditorView` 가 실제로 갖는 형태 중 이 컴포넌트가 쓰는 부분만. */
type MinimalEditorView = {
  state: { doc: { toString(): string } };
  destroy(): void;
};

/**
 * 결과물 본문을 고쳐 새 버전으로 저장하는 편집기. 링크는 한 줄 `<input type="url">`,
 * 그 외는 CodeMirror 를 지연 로드해 붙인다. 변경 여부(`dirty`)를 추적해 취소 때
 * 모달이 아니라 컴포넌트 안 배너로 확인한다.
 *
 * 테스트는 `data-testid="artifact-editor"` 엘리먼트에 실린 `cmView` 프로퍼티로 실제
 * CodeMirror view 를 얻어 `view.dispatch(...)` 로 본문을 바꾼다(이 컴포넌트가 상태를
 * React 로 미러링하지 않고 CodeMirror 문서를 정본으로 삼기 때문).
 */
export default function ArtifactEditor({
  initial,
  filename,
  isLink,
  onSave,
  onCancel,
}: ArtifactEditorProps) {
  const t = useT();
  const [linkValue, setLinkValue] = useState(initial);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<MinimalEditorView | null>(null);
  const contentRef = useRef(initial);

  useEffect(() => {
    if (isLink) return;
    let alive = true;
    let view: MinimalEditorView | null = null;
    void (async () => {
      const [cm, langData, lang] = await Promise.all([
        import("codemirror"),
        import("@codemirror/language-data"),
        import("@codemirror/language"),
      ]);
      if (!alive || !hostRef.current) return;
      const { EditorView, basicSetup } = cm;
      const updateListener = EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        contentRef.current = update.state.doc.toString();
        setDirty(contentRef.current !== initial);
      });
      const extensions = [basicSetup, updateListener];
      const desc = lang.LanguageDescription.matchFilename(langData.languages, filename);
      if (desc) {
        try {
          extensions.push(await desc.load());
        } catch {
          // 언어 지원을 못 불러오면 강조 없이 평문 편집으로 떨어진다.
        }
      }
      if (!alive || !hostRef.current) return;
      const created = new EditorView({ doc: initial, extensions, parent: hostRef.current });
      view = created;
      viewRef.current = created;
      (hostRef.current as unknown as { cmView?: unknown }).cmView = created;
    })();
    return () => {
      alive = false;
      view?.destroy();
      viewRef.current = null;
    };
    // filename·initial 은 편집 세션 동안 바뀌지 않는다 — isLink 로만 재마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLink]);

  const linkTrimmed = linkValue.trim();
  const validLink = isLink ? safeHttpUrl(linkValue) : null;
  const linkDirty = isLink && linkTrimmed !== initial.trim();
  const isDirty = isLink ? linkDirty : dirty;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const content = isLink ? `${validLink}\n` : contentRef.current;
      await onSave(content, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestCancel = () => {
    if (isDirty) {
      setConfirmingCancel(true);
      return;
    }
    onCancel();
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0 text-xs">
      {isLink ? (
        <div className="flex flex-col gap-1">
          <input
            type="url"
            aria-label={filename}
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            className="px-2 py-1 rounded-md bg-surface-raised text-text font-mono"
          />
          <p className="text-[11px] text-text-dim">{t("artifacts.edit.linkHint")}</p>
        </div>
      ) : (
        <div
          ref={hostRef}
          data-testid="artifact-editor"
          className="flex-1 min-h-0 overflow-auto rounded-md border border-border [&_.cm-editor]:h-full"
        />
      )}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("artifacts.edit.note")}
        aria-label={t("artifacts.edit.note")}
        className="px-2 py-1 rounded-md bg-surface-raised text-text"
      />
      {isDirty && <p className="text-[11px] text-amber-600">{t("artifacts.edit.dirty")}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {confirmingCancel && (
        <div
          role="alertdialog"
          className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-md bg-red-500/10"
        >
          <span className="mr-auto text-text">{t("common.unsavedChangesContinue")}</span>
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold"
          >
            {t("common.confirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingCancel(false)}
            className="px-2.5 py-1 rounded-md bg-surface-raised text-text-secondary"
          >
            {t("common.back")}
          </button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={requestCancel}
          className="px-2.5 py-1 rounded-md bg-surface-raised text-text-secondary disabled:opacity-50"
        >
          {t("artifacts.edit.cancel")}
        </button>
        <button
          type="button"
          disabled={saving || (isLink && !validLink)}
          onClick={() => void save()}
          className="px-2.5 py-1 rounded-md bg-primary text-white font-semibold disabled:opacity-50"
        >
          {t("artifacts.edit.save")}
        </button>
      </div>
    </div>
  );
}
