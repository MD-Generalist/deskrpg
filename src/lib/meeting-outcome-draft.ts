/**
 * 회의 결과를 등록하기 전에 사람이 손보는 초안.
 *
 * 1차 편집 범위는 선택·제목·담당뿐이다. 본문과 순서는 등록한 뒤 칸반에서 고친다 —
 * 종료 화면이 편집기가 되지 않게 하기 위해서다.
 */
import type { MeetingOutcome } from "./meeting-outcome";
import { tenantSlugFromName } from "./tenant-slug";

export type OutcomeDraftItem = {
  /** `outcome.followUps` 안의 원래 번호. 등록 멱등 키(`meeting:{id}:{index}`)가 이 값을 쓴다. */
  index: number;
  selected: boolean;
  title: string;
  npcId: string | null;
  after: number[];
};

export type OutcomeDraft = {
  items: OutcomeDraftItem[];
  /** 비우면 서브프로젝트(테넌트) 없이 등록한다. */
  subprojectName: string;
};

export type OutcomeRegistration = {
  tenant: { slug: string; name: string } | null;
  items: Array<{ index: number; title: string; npcId: string | null; after: number[] }>;
};

export function createOutcomeDraft(outcome: MeetingOutcome): OutcomeDraft {
  return {
    items: outcome.followUps.map((followUp, index) => ({
      index,
      selected: true,
      title: followUp.title,
      npcId: followUp.assigneeNpcId,
      after: followUp.after,
    })),
    subprojectName: outcome.project?.name ?? "",
  };
}

export function updateDraftItem(
  draft: OutcomeDraft,
  index: number,
  patch: Partial<Pick<OutcomeDraftItem, "selected" | "title" | "npcId">>,
): OutcomeDraft {
  return {
    ...draft,
    items: draft.items.map((item) => (item.index === index ? { ...item, ...patch } : item)),
  };
}

export function draftToRegistration(draft: OutcomeDraft): OutcomeRegistration {
  const kept = draft.items.filter((item) => item.selected && item.title.trim());
  const keptIndexes = new Set(kept.map((item) => item.index));
  const name = draft.subprojectName.trim();
  const slug = tenantSlugFromName(name);
  return {
    tenant: slug ? { slug, name } : null,
    items: kept.map((item) => ({
      index: item.index,
      title: item.title.trim(),
      npcId: item.npcId,
      // 선택에서 빠진 항목을 기다리면 그 카드는 영영 시작하지 못한다.
      after: item.after.filter((target) => keptIndexes.has(target)),
    })),
  };
}
