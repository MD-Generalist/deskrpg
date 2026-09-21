"use client";
import { useEffect, useState } from "react";
import {
  Atom,
  Database,
  File,
  FileText,
  Film,
  Globe,
  Image as ImageIcon,
  Paperclip,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

import { relativeTime } from "@/components/rooms/RoomList";
import { epochSecondsToMs } from "@/lib/epoch";
import { useLocale, useT } from "@/lib/i18n";
import {
  ARTIFACT_CATEGORIES,
  ARTIFACT_SOURCES,
  type ArtifactCategory,
  type ArtifactKind,
  type ArtifactSource,
  type ArtifactSummary,
} from "@/lib/hermes/deskrpg-plugin-types";

import { safeHttpUrl } from "./artifact-view-model";
import type { GalleryAttachment } from "./card-attachments";
import { LinkIcon } from "./viewers/link-icon";

export type ArtifactFilter = {
  category?: ArtifactCategory;
  source?: ArtifactSource;
  profile?: string;
  q?: string;
};

/** 탭 순서 — 전체 다음 미디어·파일·링크(`ARTIFACT_CATEGORIES` 선언 순). */
const TAB_CATEGORIES = Object.keys(ARTIFACT_CATEGORIES) as ArtifactCategory[];

export type ArtifactListNpc = { profileName: string; npcName: string; npcId: string };

const KIND_ICONS: Record<Exclude<ArtifactKind, "link">, LucideIcon> = {
  document: FileText,
  image: ImageIcon,
  media: Film,
  web: Globe,
  react: Atom,
  data: Database,
  file: File,
};

/** 결과물 종류 아이콘 — 목록 행과 칸반 카드의 결과물 섹션이 같이 쓴다. */
export function KindIcon({ artifact }: { artifact: ArtifactSummary }) {
  if (artifact.kind === "link") {
    // 목록 요약에는 URL 이 없다 — 제목·요약이 URL 이면 그걸로 브랜드를 고르고, 아니면 Link2.
    const url = safeHttpUrl(artifact.summary ?? "") ?? safeHttpUrl(artifact.title);
    return <LinkIcon url={url} className="w-4 h-4 flex-shrink-0 text-text-secondary" />;
  }
  const Icon = KIND_ICONS[artifact.kind] ?? File;
  return <Icon className="w-4 h-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />;
}

export type ArtifactListProps = {
  items: ArtifactSummary[];
  filter: ArtifactFilter;
  onFilter(next: ArtifactFilter): void;
  npcs: ArtifactListNpc[];
  selectedId: string | null;
  onSelect(id: string): void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore(): void;
  thumbnailUrl(artifact: ArtifactSummary): string;
  /**
   * 아티팩트 뒤에 잇는 카드 첨부(이미 걸러진 것). 워커가 만든 파일은 카드가 끝나면 scratch 와
   * 함께 지워지고 첨부만 남는다 — 이게 없으면 끝난 카드의 결과물이 어디에도 안 보인다.
   */
  cardAttachments?: GalleryAttachment[];
  /** 플러그인이 보드 첨부 목록을 모르면 false — 왜 첨부가 없는지 한 줄 알린다. */
  cardAttachmentsSupported?: boolean | null;
  cardAttachmentsHasMore?: boolean;
  onLoadMoreCardAttachments?(): void;
  cardAttachmentUrl?(attachment: GalleryAttachment): string;
};

/** 종류 탭·출처·NPC·검색 + 행 목록(이미지 탭은 썸네일 격자와 확대 보기). */
export default function ArtifactList({
  items,
  filter,
  onFilter,
  npcs,
  selectedId,
  onSelect,
  hasMore,
  loading,
  onLoadMore,
  thumbnailUrl,
  cardAttachments = [],
  cardAttachmentsSupported = null,
  cardAttachmentsHasMore = false,
  onLoadMoreCardAttachments,
  cardAttachmentUrl,
}: ArtifactListProps) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState(filter.q ?? "");
  const [zoomed, setZoomed] = useState<ArtifactSummary | null>(null);
  // 확대 보기의 ESC 는 모달을 닫지 않고 확대만 푼다 — document 가 window 보다 먼저 받으므로
  // 여기서 preventDefault 하면 모달(window 리스너)이 건너뛴다.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setZoomed(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed]);
  const npcName = (profile: string) =>
    npcs.find((n) => n.profileName === profile)?.npcName ?? profile;
  const select = "px-1.5 py-1 rounded-md bg-surface-raised text-text-secondary min-w-0";

  return (
    <div className="flex flex-col h-full min-h-0 text-xs">
      <div role="tablist" className="flex flex-wrap gap-1 px-3 pt-3">
        {([undefined, ...TAB_CATEGORIES] as Array<ArtifactCategory | undefined>).map((category) => (
          <button
            key={category ?? "all"}
            type="button"
            role="tab"
            aria-selected={filter.category === category}
            onClick={() => onFilter({ ...filter, category })}
            className={`px-2 py-0.5 rounded-full ${
              filter.category === category
                ? "bg-primary text-white"
                : "bg-surface-raised text-text-secondary hover:brightness-125"
            }`}
          >
            {t(`artifacts.tab.${category ?? "all"}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <select
          aria-label={t("artifacts.source.all")}
          value={filter.source ?? ""}
          onChange={(e) =>
            onFilter({ ...filter, source: (e.target.value || undefined) as ArtifactSource })
          }
          className={select}
        >
          <option value="">{t("artifacts.source.all")}</option>
          {ARTIFACT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`artifacts.source.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("artifacts.npc.all")}
          value={filter.profile ?? ""}
          onChange={(e) => onFilter({ ...filter, profile: e.target.value || undefined })}
          className={select}
        >
          <option value="">{t("artifacts.npc.all")}</option>
          {npcs.map((n) => (
            <option key={n.npcId} value={n.profileName}>
              {n.npcName}
            </option>
          ))}
        </select>
        <label className="flex flex-1 items-center gap-1 px-1.5 py-1 rounded-md bg-surface-raised min-w-0">
          <Search className="w-3.5 h-3.5 text-text-dim flex-shrink-0" />
          <input
            type="search"
            value={query}
            placeholder={t("artifacts.search")}
            aria-label={t("artifacts.search")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onFilter({ ...filter, q: query.trim() || undefined });
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-text"
          />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 && !loading && (
          <p className="p-4 text-text-dim">{t("artifacts.empty")}</p>
        )}
        {filter.category === "media" ? (
          <div className="grid grid-cols-3 gap-2 p-3">
            {items.map((a) =>
              a.kind === "image" ? (
                <button
                  key={a.id}
                  type="button"
                  title={a.title}
                  aria-label={a.title}
                  onClick={() => {
                    onSelect(a.id);
                    setZoomed(a);
                  }}
                  className={`aspect-square overflow-hidden rounded-md border ${
                    a.id === selectedId ? "border-primary" : "border-border"
                  } bg-surface`}
                >
                  <img
                    src={thumbnailUrl(a)}
                    alt={a.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
              ) : (
                // 오디오·비디오는 썸네일이 없다 — 아이콘 타일 + 제목.
                <button
                  key={a.id}
                  type="button"
                  title={a.title}
                  aria-label={a.title}
                  onClick={() => onSelect(a.id)}
                  className={`aspect-square flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border p-2 text-center ${
                    a.id === selectedId ? "border-primary" : "border-border"
                  } bg-surface`}
                >
                  <KindIcon artifact={a} />
                  <span className="line-clamp-2 text-[11px] text-text-secondary break-words">
                    {a.title}
                  </span>
                </button>
              ),
            )}
          </div>
        ) : (
          <ul>
            {items.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  aria-current={a.id === selectedId ? "true" : undefined}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left border-b border-border hover:bg-surface-raised ${
                    a.id === selectedId ? "bg-surface-raised" : ""
                  }`}
                >
                  <KindIcon artifact={a} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-semibold text-text">{a.title}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
                      <span className="truncate">{npcName(a.profile)}</span>
                      <span className="px-1 rounded bg-surface text-text-secondary">
                        {t(`artifacts.source.${a.source_kind}`)}
                      </span>
                      <span>
                        {relativeTime(
                          new Date(epochSecondsToMs(a.updated_at)).toISOString(),
                          locale,
                        )}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {loading && <p className="p-3 text-text-dim">{t("common.loading")}</p>}
        {hasMore && !loading && (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full py-2 text-text-secondary hover:text-text"
          >
            {t("artifacts.loadMore")}
          </button>
        )}
        {cardAttachmentsSupported === false && (
          <p
            data-testid="card-attachments-unsupported"
            className="px-3 py-2 text-[11px] text-text-dim"
          >
            {t("artifacts.attachments.unsupported")}
          </p>
        )}
        {cardAttachments.length > 0 && cardAttachmentUrl && (
          <section data-testid="card-attachments" aria-label={t("artifacts.attachments.title")}>
            <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold text-text-dim">
              {t("artifacts.attachments.title")}
            </h3>
            <ul>
              {cardAttachments.map((file) => (
                <li key={`${file.boardSlug}:${file.id}`}>
                  <a
                    href={cardAttachmentUrl(file)}
                    download={file.filename}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left border-b border-border hover:bg-surface-raised"
                  >
                    <Paperclip
                      className="w-4 h-4 flex-shrink-0 text-text-secondary"
                      aria-hidden="true"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-semibold text-text">
                        {file.filename}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
                        <span className="truncate">
                          {file.task_title ?? t("artifacts.attachments.untitledCard")}
                        </span>
                        <span className="px-1 rounded bg-surface text-text-secondary">
                          {t("artifacts.card.fromAttachment")}
                        </span>
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {cardAttachmentsHasMore && onLoadMoreCardAttachments && (
              <button
                type="button"
                onClick={onLoadMoreCardAttachments}
                className="w-full py-2 text-text-secondary hover:text-text"
              >
                {t("artifacts.loadMore")}
              </button>
            )}
          </section>
        )}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => setZoomed(null)}
        >
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute top-4 right-4 text-white"
            onClick={() => setZoomed(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={thumbnailUrl(zoomed)}
            alt={zoomed.title}
            className="max-w-[92vw] max-h-[88dvh] object-contain"
          />
        </div>
      )}
    </div>
  );
}
