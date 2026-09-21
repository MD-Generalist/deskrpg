"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { createKanbanApi, type FetchLike } from "@/components/kanban/kanban-api";

import type { GalleryAttachment } from "./card-attachments";

type BoardCursor = { boardSlug: string | undefined; cursor: string };

/**
 * 결과물 갤러리가 잇는 카드 첨부를 채널의 **보드마다 한 번씩** 읽는다(카드 수와 무관).
 *
 * - `supported` 가 false 면 플러그인이 보드 전체 목록을 모른다 — 화면은 아티팩트만 그리고
 *   왜 첨부가 없는지 한 줄 알린다. null 은 아직 모른다(조용히 둔다).
 * - 보드 목록·첨부 조회가 실패해도 갤러리를 깨지 않는다. 칸반 연결 문제는 아티팩트 쪽 안내가
 *   이미 말하고, 여기서 또 오류를 띄우면 같은 문제를 두 번 말한다.
 */
export function useCardAttachments(channelId: string, fetchImpl?: FetchLike) {
  const [items, setItems] = useState<GalleryAttachment[]>([]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [cursors, setCursors] = useState<BoardCursor[]>([]);
  const sequence = useRef(0);

  const readBoard = useCallback(
    async (boardSlug: string | undefined, cursor?: string) => {
      const page = await createKanbanApi(channelId, fetchImpl, boardSlug).boardAttachments(cursor);
      return {
        supported: page.supported,
        items: page.attachments.map((a) => ({ ...a, boardSlug: boardSlug ?? "" })),
        next: page.next_cursor ? { boardSlug, cursor: page.next_cursor } : null,
      };
    },
    [channelId, fetchImpl],
  );

  useEffect(() => {
    const mine = ++sequence.current;
    void (async () => {
      let boards: Array<string | undefined>;
      try {
        const { projects } = await createKanbanApi(channelId, fetchImpl).projects();
        boards = projects.length > 0 ? projects.map((p) => p.boardSlug) : [undefined];
      } catch {
        boards = [undefined];
      }
      const pages = await Promise.all(boards.map((b) => readBoard(b).catch(() => null)));
      if (mine !== sequence.current) return;
      const ok = pages.filter((p): p is NonNullable<typeof p> => p !== null);
      setSupported(ok.length === 0 ? null : ok.some((p) => p.supported));
      setItems(ok.flatMap((p) => p.items));
      setCursors(ok.flatMap((p) => (p.next ? [p.next] : [])));
    })();
  }, [channelId, fetchImpl, readBoard]);

  const loadMore = useCallback(async () => {
    const mine = sequence.current;
    const pages = await Promise.all(
      cursors.map((c) => readBoard(c.boardSlug, c.cursor).catch(() => null)),
    );
    if (mine !== sequence.current) return;
    const ok = pages.filter((p): p is NonNullable<typeof p> => p !== null);
    setItems((prev) => {
      const seen = new Set(prev.map((a) => `${a.boardSlug}\u0000${a.id}`));
      return [
        ...prev,
        ...ok.flatMap((p) => p.items).filter((a) => !seen.has(`${a.boardSlug}\u0000${a.id}`)),
      ];
    });
    setCursors(ok.flatMap((p) => (p.next ? [p.next] : [])));
  }, [cursors, readBoard]);

  return { items, supported, hasMore: cursors.length > 0, loadMore };
}
