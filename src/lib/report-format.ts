/**
 * 직원이 **사용자에게 보고할 때의 표현 규칙**(카드 PVTI_…70a2Y).
 *
 * 화면은 이미 받아 줄 준비가 돼 있다 — 직원 메시지는 마크다운으로 렌더되고
 * (`src/components/ui/ChatBubble.tsx:38`) `![](URL)` 은 `<img>` 로 그려진다
 * (`src/components/ui/MarkdownContent.tsx:103-105`). 없는 것은 "그렇게 내라"는 지시뿐이었다.
 *
 * `user-context.ts` 와 같은 원칙을 따른다: 시스템 프롬프트가 아니라 **메시지 앞머리**이고,
 * Hermes 프로필의 SOUL 을 덮지 않는다. 규칙을 인격에 맡기면 직원마다 달라지기 때문에
 * 여기 한 곳에 두고, 대화 경로(DM·오피스 전체·회의)가 같은 문자열을 쓴다.
 *
 * 칸반 카드 경로에는 넣지 않는다(2026-09-20 단테 결정) — 그 경로의 주입 자리는
 * 사람이 읽는 카드 본문(`kanban-routes.ts:208`)이라 규칙 문단이 화면을 더럽힌다.
 */

export const REPORT_FORMAT_HEADER = "[보고 형식]";

/** 한 줄 항목만 둔다 — 앞머리가 길어지면 실제 대본이 뒤로 밀린다. */
const RULES: readonly string[] = [
  "이미지는 브라우저가 열 수 있는 URL 로 ![설명](URL) 마크다운으로 넣는다. 서버 파일 경로만 적지 않는다.",
  "이미지 URL 이 없으면 결과물로 저장한 뒤 그 링크를 쓴다. 만들지 못했으면 만들었다고 말하지 않는다.",
  "참고한 사이트는 문장 안에 묻지 말고 한 줄에 URL 하나씩 적는다.",
  "표·코드·목록은 마크다운 문법을 쓴다.",
];

export function formatReportFormat(): string {
  return [REPORT_FORMAT_HEADER, ...RULES.map((r) => `- ${r}`)].join("\n");
}

/**
 * 대본 앞머리에 규칙을 붙인다. 빈 대본은 그대로 돌려준다 — 보낼 말이 없는데
 * 규칙만 가는 일이 없게 한다.
 */
export function prefixReportFormat(prompt: string): string {
  if (!prompt) return prompt;
  return `${formatReportFormat()}\n\n${prompt}`;
}
