import type { HubSearchResult } from "@/lib/hermes/plugin-client-types";

/** 신뢰 등급 순서 — 낮을수록 앞. 모르는 등급은 community 뒤. */
const TRUST_RANK: Record<string, number> = { builtin: 0, trusted: 1, community: 2 };
const rank = (trust: string) => TRUST_RANK[trust] ?? 3;

/**
 * Hub 검색 결과를 신뢰 등급(builtin > trusted > community) 순으로 둔다. 같은 등급 안에서는 서버가 준 순서를 지킨다
 * (`Array.prototype.sort` 는 안정 정렬이다). 입력 배열은 바꾸지 않는다.
 */
export function sortHubResults(results: HubSearchResult[]): HubSearchResult[] {
  return [...results].sort((a, b) => rank(a.trustLevel) - rank(b.trustLevel));
}
