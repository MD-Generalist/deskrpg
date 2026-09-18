"use client";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpRight, Copy, Download, Trash2, X } from "lucide-react";

import MarkdownContent from "@/components/ui/MarkdownContent";
import { useT } from "@/lib/i18n";
import type { ArtifactDetail } from "@/lib/hermes/deskrpg-plugin-types";

import type { ArtifactsApi } from "./artifacts-api";
import {
  codeLanguageFor,
  hasRenderedMode,
  sourceTarget,
  TEXT_PREVIEW_MAX_BYTES,
  viewerFor,
  type SourceTarget,
  type ViewerKind,
} from "./artifact-view-model";
import CsvViewer from "./viewers/CsvViewer";
import HtmlViewer from "./viewers/HtmlViewer";
import LinkViewer from "./viewers/LinkViewer";
import MediaViewer from "./viewers/MediaViewer";

// 무겁다(pdf.js·shiki·dompurify) — 실제 쓰일 때만 지연 로드한다.
const PdfViewer = lazy(() => import("./viewers/PdfViewer"));
const CodeViewer = lazy(() => import("./viewers/CodeViewer"));
const SvgViewer = lazy(() => import("./viewers/SvgViewer"));

/** 본문을 텍스트로 읽어야 그릴 수 있는 뷰어. 나머지는 URL 만으로 그린다. */
const TEXT_VIEWERS: ReadonlySet<ViewerKind> = new Set([
  "markdown",
  "text",
  "html",
  "csv",
  "link",
  "code",
  "svg",
]);

/** 렌더/소스 전환을 켜는 뷰어. */
const showsModeToggle = hasRenderedMode;

type Content = { version: number; text: string; truncated: boolean };

class RenderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export type ArtifactViewerProps = {
  api: ArtifactsApi;
  artifactId: string;
  /** 바뀌면 상세를 다시 읽고 최신 버전으로 돌아간다(이 결과물의 `artifact.versioned`). */
  reloadKey: number;
  onOpenSource(target: SourceTarget): void;
  onDeleted(id: string): void;
  onClose(): void;
};

/**
 * 결과물 하나의 상세. 버전 선택·렌더/소스·복사·다운로드·출처 이동·삭제(모달 안 확인)를 머리에
 * 두고, 본문은 `viewerFor` 가 고른 가벼운 뷰어로 그린다. 뷰어가 던지면 다운로드로 떨어진다.
 */
export default function ArtifactViewer({
  api,
  artifactId,
  reloadKey,
  onOpenSource,
  onDeleted,
  onClose,
}: ArtifactViewerProps) {
  const t = useT();
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [loaded, setLoaded] = useState<Content | null>(null);
  const [blobLoaded, setBlobLoaded] = useState<{ version: number; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api.get(artifactId).then(
      (next) => {
        if (!alive) return;
        setError(null);
        setDetail(next);
        setVersion(next.artifact.current_version);
      },
      (err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, artifactId, reloadKey]);

  const artifact = detail?.artifact.id === artifactId ? detail.artifact : null;
  const selected = artifact ? detail?.versions.find((v) => v.version === version) : undefined;
  const shape = artifact && {
    kind: artifact.kind,
    mime: selected?.mime ?? artifact.mime,
    filename: selected?.filename ?? artifact.filename,
  };
  const viewer: ViewerKind | null = shape ? viewerFor(shape) : null;
  const needsText = !!viewer && TEXT_VIEWERS.has(viewer) && !artifact?.missing;
  const needsBlob = viewer === "pdf" && !artifact?.missing;
  // 버전을 바꾸면 새 본문이 올 때까지 옛 본문을 보이지 않는다.
  const content = needsText && loaded?.version === version ? loaded : null;
  const blobContent = needsBlob && blobLoaded?.version === version ? blobLoaded.blob : null;

  useEffect(() => {
    if (!needsText || version === null) return;
    let alive = true;
    api.fetchText(artifactId, version, TEXT_PREVIEW_MAX_BYTES).then(
      (next) => {
        if (alive) setLoaded({ version, ...next });
      },
      (err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, artifactId, version, needsText]);

  useEffect(() => {
    if (!needsBlob || version === null) return;
    let alive = true;
    api.fetchBlob(artifactId, version).then(
      (blob) => {
        if (alive) setBlobLoaded({ version, blob });
      },
      (err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, artifactId, version, needsBlob]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.remove(artifactId);
      onDeleted(artifactId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (!artifact || version === null || !viewer) {
    return (
      <div className="p-4 text-xs text-text-dim">
        {error ? `${t("artifacts.error")} — ${error}` : t("common.loading")}
      </div>
    );
  }

  const downloadHref = api.contentUrl(artifactId, version, true);
  const downloadLink = (
    <a
      href={downloadHref}
      download
      className="inline-flex items-center gap-1 underline text-primary"
    >
      <Download className="w-3.5 h-3.5" />
      {t("artifacts.download")}
    </a>
  );
  const contentUrl = api.contentUrl(artifactId, version);
  const btn =
    "inline-flex items-center gap-1 px-2 py-1 rounded-md bg-surface-raised text-text-secondary hover:brightness-125 disabled:opacity-50";

  const body = (() => {
    if (artifact.missing) return <p className="text-text-secondary">{t("artifacts.missing")}</p>;
    if (viewer === "image")
      return (
        <img src={contentUrl} alt={artifact.title} className="max-w-full mx-auto rounded-md" />
      );
    if (viewer === "audio" || viewer === "video")
      return <MediaViewer kind={viewer} src={contentUrl} />;
    if (viewer === "download")
      return (
        <p className="text-text-secondary flex items-center gap-2">
          {t("artifacts.noPreview")} {downloadLink}
        </p>
      );
    if (viewer === "pdf") {
      if (!blobContent) return <p className="text-text-dim">{t("common.loading")}</p>;
      return (
        <Suspense fallback={<p className="text-text-dim">{t("common.loading")}</p>}>
          <PdfViewer blob={blobContent} />
        </Suspense>
      );
    }
    if (!content) return <p className="text-text-dim">{t("common.loading")}</p>;
    const { text } = content;
    const pre = <pre className="whitespace-pre-wrap font-mono text-xs break-words">{text}</pre>;
    const filename = shape!.filename;
    if (mode === "source" && showsModeToggle(viewer)) {
      const sourceLanguage = viewer === "svg" ? "xml" : viewer === "html" ? "html" : "markdown";
      return (
        <Suspense fallback={pre}>
          <CodeViewer text={text} language={sourceLanguage} />
        </Suspense>
      );
    }
    switch (viewer) {
      case "markdown":
        return <MarkdownContent content={text} />;
      case "html":
        return <HtmlViewer text={text} title={artifact.title} />;
      case "csv":
        return <CsvViewer text={text} />;
      case "link":
        return <LinkViewer text={text} onCopy={copy} copied={copied} />;
      case "svg":
        return (
          <Suspense fallback={pre}>
            <SvgViewer text={text} />
          </Suspense>
        );
      default:
        // text·code
        return (
          <Suspense fallback={pre}>
            <CodeViewer text={text} language={codeLanguageFor(filename)} />
          </Suspense>
        );
    }
  })();

  const copyable = needsText && !!content && viewer !== "link";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border text-xs">
        <h3 className="text-sm font-bold text-text mr-auto break-all">{artifact.title}</h3>
        <select
          aria-label={t("artifacts.version")}
          value={version}
          onChange={(e) => setVersion(Number(e.target.value))}
          className="px-1.5 py-1 rounded-md bg-surface-raised text-text-secondary"
        >
          {detail!.versions.map((v) => (
            <option key={v.version} value={v.version} disabled={v.pruned_at !== undefined}>
              {`v${v.version}${v.pruned_at !== undefined ? ` · ${t("artifacts.pruned")}` : ""}`}
            </option>
          ))}
        </select>
        {showsModeToggle(viewer) && (
          <div className="inline-flex rounded-md overflow-hidden border border-border">
            {(["rendered", "source"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 ${mode === m ? "bg-primary text-white" : "bg-surface-raised text-text-secondary"}`}
              >
                {t(m === "rendered" ? "artifacts.rendered" : "artifacts.source")}
              </button>
            ))}
          </div>
        )}
        {copyable && (
          <button type="button" className={btn} onClick={() => copy(content.text)}>
            <Copy className="w-3.5 h-3.5" />
            <span>{copied ? t("artifacts.copied") : t("artifacts.copy")}</span>
          </button>
        )}
        <a href={downloadHref} download className={btn}>
          <Download className="w-3.5 h-3.5" />
          <span>{t("artifacts.download")}</span>
        </a>
        <button type="button" className={btn} onClick={() => onOpenSource(sourceTarget(artifact))}>
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>{t("artifacts.goToSource")}</span>
        </button>
        {!confirming && (
          <button type="button" className={btn} onClick={() => setConfirming(true)}>
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("artifacts.delete")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="p-1 text-text-muted hover:text-text"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-red-500/10 text-xs"
        >
          <span className="mr-auto text-text">{t("artifacts.deleteConfirm")}</span>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void remove()}
            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50"
          >
            {t("artifacts.delete")}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirming(false)}
            className={btn}
          >
            {t("artifacts.deleteCancel")}
          </button>
        </div>
      )}
      {error && (
        <p className="px-4 py-2 text-xs text-red-500 border-b border-border break-words">
          {t("artifacts.error")} — {error}
        </p>
      )}
      {content?.truncated && (
        <p className="px-4 py-2 text-xs text-amber-600 border-b border-border">
          {t("artifacts.truncated")}
        </p>
      )}
      <div className="flex-1 min-h-0 overflow-auto p-4 text-xs">
        <RenderBoundary
          key={`${artifactId}:${version}:${mode}`}
          fallback={
            <p className="text-text-secondary flex items-center gap-2">
              {t("artifacts.renderFailed")} {downloadLink}
            </p>
          }
        >
          {body}
        </RenderBoundary>
      </div>
    </div>
  );
}
