"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import type { LinkPreview } from "@/lib/link-preview/parse";

/**
 * 한 줄에 링크만 있는 문단을 제목·설명·썸네일 카드로 승격한다. 조회가 실패하거나
 * 미리보기가 없으면(204) **아무것도 바꾸지 않는다** — 원래의 밑줄 링크가 그대로 남는다.
 *
 * 서버가 이미 받아 온 것을 다시 그린다. 브라우저는 남의 사이트를 직접 물지 않는다
 * (`/api/link-preview`, og:image 도 `/api/link-preview/image` 프록시를 거친다).
 */
export default function LinkPreviewCard({
  url,
  fallback,
}: {
  url: string;
  fallback: React.ReactNode;
}) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (!alive || res.status !== 200) return;
        const data = (await res.json()) as LinkPreview;
        if (alive) setPreview(data);
      } catch {
        // 조용히 밑줄 링크로 남는다.
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  if (!preview) return <>{fallback}</>;

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = preview.siteName ?? "";
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-link-preview={host}
      className="my-1.5 flex gap-2 overflow-hidden rounded-md border border-border bg-surface no-underline hover:brightness-110"
    >
      {preview.image && (
        // 남의 이미지다 — 우리 프록시를 거친 주소이고, 실패하면 자리만 비운다.
        <img src={preview.image} alt="" className="h-20 w-28 shrink-0 object-cover" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
        <span className="flex items-center gap-1 text-[10px] text-text-dim">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{preview.siteName || host}</span>
        </span>
        {preview.title && (
          <span className="line-clamp-2 text-xs font-semibold text-text">{preview.title}</span>
        )}
        {preview.description && (
          <span className="line-clamp-2 text-[11px] text-text-secondary">
            {preview.description}
          </span>
        )}
      </span>
    </a>
  );
}
