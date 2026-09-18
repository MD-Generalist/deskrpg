"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Package, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { ArtifactSummary } from "@/lib/hermes/deskrpg-plugin-types";

import ArtifactList, { type ArtifactFilter, type ArtifactListNpc } from "./ArtifactList";
import ArtifactViewer from "./ArtifactViewer";
import { ArtifactsApiError, createArtifactsApi } from "./artifacts-api";
import type { SourceTarget } from "./artifact-view-model";

export type ArtifactsModalProps = {
  channelId: string;
  npcs: ArtifactListNpc[];
  /** `artifact:event` 마다 오른다(GamePageClient 가 소켓을 든다). 디바운스해 목록을 재조회. */
  refreshTick: number;
  lastEvent: { kind: string; artifactId: string } | null;
  initialArtifactId?: string | null;
  /** 카드에서 열 때 필터 — 목록 요청마다 `taskId` 로 붙는다. */
  initialTaskId?: string | null;
  onOpenSource(target: SourceTarget): void;
  onClose(): void;
  /** 사건 → 재조회 디바운스(ms). 기본 `ARTIFACTS_EVENT_DEBOUNCE_MS`. */
  debounceMs?: number;
};

/** `artifact:event` 연타를 한 번의 재조회로 접는 간격. */
export const ARTIFACTS_EVENT_DEBOUNCE_MS = 300;

/**
 * 채널 결과물 모달. 왼쪽은 필터·목록, 오른쪽은 고른 결과물의 뷰어. 목록은 필터가 바뀌면 곧바로,
 * `refreshTick` 이 오르면 디바운스해 처음부터 다시 읽는다. 409·428 은 목록 대신 안내를 그린다.
 */
export default function ArtifactsModal({
  channelId,
  npcs,
  refreshTick,
  lastEvent,
  initialArtifactId = null,
  initialTaskId = null,
  onOpenSource,
  onClose,
  debounceMs = ARTIFACTS_EVENT_DEBOUNCE_MS,
}: ArtifactsModalProps) {
  const t = useT();
  const api = useMemo(() => createArtifactsApi(channelId), [channelId]);
  const [filter, setFilter] = useState<ArtifactFilter>({});
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ArtifactsApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialArtifactId);
  const [viewerReload, setViewerReload] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (initialArtifactId) setSelectedId(initialArtifactId);
  }, [initialArtifactId]);

  const load = useCallback(
    async (after?: string) => {
      const mine = ++sequence.current;
      setLoading(true);
      try {
        const page = await api.list({ ...filter, taskId: initialTaskId ?? undefined }, after);
        if (mine !== sequence.current) return;
        setItems((prev) => {
          if (!after) return page.artifacts;
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...page.artifacts.filter((a) => !seen.has(a.id))];
        });
        setCursor(page.cursor);
        setHasMore(page.has_more);
        setError(null);
      } catch (err) {
        if (mine !== sequence.current) return;
        setError(
          err instanceof ArtifactsApiError
            ? err
            : new ArtifactsApiError(0, "unknown", err instanceof Error ? err.message : String(err)),
        );
      } finally {
        if (mine === sequence.current) setLoading(false);
      }
    },
    [api, filter, initialTaskId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // `artifact:event` — 디바운스 후 처음부터 재조회. 최신 `load` 는 ref 로 읽어, 필터가 바뀐
  // 것만으로 이 타이머가 다시 걸리지 않게 한다.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (refreshTick === 0) return;
    const timer = setTimeout(() => void loadRef.current(), debounceMs);
    return () => clearTimeout(timer);
  }, [refreshTick, debounceMs]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.kind === "artifact.deleted") removeItem(lastEvent.artifactId);
    else if (lastEvent.kind === "artifact.versioned" && lastEvent.artifactId === selectedId)
      setViewerReload((n) => n + 1);
    // selectedId 는 일부러 뺀다 — 선택을 바꿨다고 지난 사건을 다시 적용하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent, removeItem]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 목록의 이미지 확대 보기가 먼저 받아 preventDefault 하면 모달은 닫지 않는다.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gate = error?.status === 409 ? "gateway" : error?.status === 428 ? "upgrade" : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifacts-modal-title"
        className="bg-bg border border-border rounded-xl shadow-2xl w-[96vw] max-w-[1400px] h-[88dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <h2 id="artifacts-modal-title" className="text-sm font-bold flex items-center gap-1.5">
            <Package className="w-4 h-4" />
            {t("artifacts.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-1 text-text-muted hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {gate ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div
              data-gate={gate}
              className="mx-auto mt-8 max-w-[560px] rounded-xl border border-border bg-surface p-5 text-xs"
            >
              <div className="text-sm font-bold text-text flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                {gate === "gateway"
                  ? t("artifacts.gate.gateway")
                  : t("artifacts.gate.upgrade", { minVersion: error?.minVersion ?? "0.8.0" })}
              </div>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-border text-xs text-red-500">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="break-words">
                  {t("artifacts.error")} — {error.message}
                </span>
                <button type="button" className="ml-auto underline" onClick={() => void load()}>
                  {t("common.retry")}
                </button>
              </div>
            )}
            <div className="flex flex-1 min-h-0">
              <div
                className={`w-full md:w-[380px] md:flex-shrink-0 md:border-r border-border min-h-0 ${
                  selectedId ? "hidden md:block" : "block"
                }`}
              >
                <ArtifactList
                  items={items}
                  filter={filter}
                  onFilter={setFilter}
                  npcs={npcs}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  hasMore={hasMore}
                  loading={loading}
                  onLoadMore={() => void load(cursor)}
                  thumbnailUrl={(a) => api.contentUrl(a.id, a.current_version)}
                />
              </div>
              <div className={`flex-1 min-w-0 min-h-0 ${selectedId ? "block" : "hidden md:block"}`}>
                {selectedId ? (
                  <ArtifactViewer
                    key={selectedId}
                    api={api}
                    artifactId={selectedId}
                    reloadKey={viewerReload}
                    onOpenSource={onOpenSource}
                    onDeleted={removeItem}
                    onClose={() => setSelectedId(null)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-text-dim">
                    <Package className="w-10 h-10 opacity-30" aria-hidden="true" />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
