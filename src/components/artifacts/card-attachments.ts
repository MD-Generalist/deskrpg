import type { ArtifactSummary, KanbanBoardAttachment } from "@/lib/hermes/deskrpg-plugin-types";

import type { ArtifactFilter } from "./ArtifactList";

/** 갤러리에 잇는 카드 첨부 한 건 — 어느 보드의 것인지 들고 다녀야 내려받을 수 있다. */
export type GalleryAttachment = KanbanBoardAttachment & { boardSlug: string };

/**
 * 결과물 갤러리가 아티팩트 뒤에 보여 줄 카드 첨부를 고른다.
 *
 * - **같은 문서를 두 번 보여 주지 않는다.** 워커가 플러그인을 싣고 뜨면 같은 파일이 아티팩트로도,
 *   카드 첨부로도 잡힌다. 같은 카드(`task_id`)의 같은 파일명이면 아티팩트만 남긴다 — 아티팩트는
 *   버전·미리보기를 갖고 있어 더 많은 것을 보여 준다. 판정은 **지금 불러온** 아티팩트 쪽만 본다.
 * - 첨부에는 종류·출처·직원이 없다. 그 필터가 걸려 있으면 보여 주지 않는다 — 걸러 낼 근거가
 *   없는 것을 통과시키면 필터가 거짓말을 한다. 종류 탭은 "전체" 와 "파일" 에서만 보인다.
 * - 카드에서 열었으면(`taskId`) 그 카드의 첨부만.
 * - 검색어는 파일명과 카드 제목에서 찾는다.
 */
export function visibleCardAttachments(
  attachments: readonly GalleryAttachment[],
  artifacts: readonly ArtifactSummary[],
  filter: ArtifactFilter,
  taskId: string | null,
): GalleryAttachment[] {
  if (filter.category && filter.category !== "file") return [];
  if (filter.source || filter.profile) return [];
  const shown = new Set(
    artifacts.filter((a) => a.task_id).map((a) => `${a.task_id}\u0000${a.filename}`),
  );
  const q = filter.q?.trim().toLowerCase() ?? "";
  return attachments.filter((a) => {
    if (taskId && a.task_id !== taskId) return false;
    if (shown.has(`${a.task_id}\u0000${a.filename}`)) return false;
    if (!q) return true;
    return a.filename.toLowerCase().includes(q) || (a.task_title ?? "").toLowerCase().includes(q);
  });
}
