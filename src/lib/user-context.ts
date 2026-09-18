/**
 * 직원에게 가는 모든 대화 앞머리에 붙는 "이 사람이 누구인지"(스펙 2026-09-18).
 *
 * 시스템 프롬프트가 아니라 **메시지 앞머리**다 — Hermes 프로필의 SOUL 을 덮지 않는다.
 * 순수 함수만 둔다. 어디에 붙일지는 호출부(소켓 핸들러·자유채팅 런타임·칸반 라우트)가 정한다.
 */
import { BIO_MAX_LENGTH } from "@/lib/my-character-limits";

export type UserContext = { name: string; bio: string | null };

const HEADER = "[대화 상대]";

/**
 * 한 줄로 접는다. `\r`·U+2028·U+2029 도 줄바꿈으로 본다 — 이름·소개에 줄바꿈이 남으면
 * 가짜 `[대화 상대]` 머리나 지시문 줄을 만들 수 있다.
 */
function foldLine(text: string): string {
  return text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim();
}

function foldBio(bio: string | null): string | null {
  if (!bio) return null;
  const folded = foldLine(bio);
  if (!folded) return null;
  return folded.length > BIO_MAX_LENGTH ? `${folded.slice(0, BIO_MAX_LENGTH)}…` : folded;
}

export function formatUserContext(ctx: UserContext): string {
  const name = foldLine(ctx.name);
  const bio = foldBio(ctx.bio);
  return bio ? `${HEADER} 이름: ${name} · 소개: ${bio}` : `${HEADER} 이름: ${name}`;
}

export function prefixUserContext(prompt: string, ctx: UserContext | null | undefined): string {
  if (!ctx || !ctx.name) return prompt;
  return `${formatUserContext(ctx)}\n\n${prompt}`;
}

export function requesterLine(ctx: UserContext): string {
  const name = foldLine(ctx.name);
  const bio = foldBio(ctx.bio);
  return bio ? `요청자: ${name} — ${bio}` : `요청자: ${name}`;
}

/**
 * 칸반 카드 본문 **끝**에 요청자 줄을 붙인다 — 사람이 읽는 카드라 앞머리를 더럽히지 않는다.
 * 컨텍스트가 없으면(캐릭터 없음) 본문을 그대로 돌려준다.
 */
export function appendRequesterLine(
  body: string | undefined,
  ctx: UserContext | null | undefined,
): string | undefined {
  if (!ctx || !ctx.name) return body;
  // 끝 공백만 정리한다 — 본문 앞의 들여쓰기(코드 블록 등)는 사용자가 쓴 그대로 둔다.
  const head = (body ?? "").trimEnd();
  const line = requesterLine(ctx);
  return head ? `${head}\n\n${line}` : line;
}
