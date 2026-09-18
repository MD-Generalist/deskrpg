/**
 * 직원에게 가는 모든 대화 앞머리에 붙는 "이 사람이 누구인지"(스펙 2026-09-18).
 *
 * 시스템 프롬프트가 아니라 **메시지 앞머리**다 — Hermes 프로필의 SOUL 을 덮지 않는다.
 * 순수 함수만 둔다. 어디에 붙일지는 호출부(소켓 핸들러·자유채팅 런타임·칸반 라우트)가 정한다.
 */
import { BIO_MAX_LENGTH } from "@/lib/my-character-limits";

export type UserContext = { name: string; bio: string | null };

const HEADER = "[대화 상대]";

function foldBio(bio: string | null): string | null {
  if (!bio) return null;
  const folded = bio.replace(/\s*\n+\s*/g, " ").trim();
  if (!folded) return null;
  return folded.length > BIO_MAX_LENGTH ? `${folded.slice(0, BIO_MAX_LENGTH)}…` : folded;
}

export function formatUserContext(ctx: UserContext): string {
  const bio = foldBio(ctx.bio);
  return bio ? `${HEADER} 이름: ${ctx.name} · 소개: ${bio}` : `${HEADER} 이름: ${ctx.name}`;
}

export function prefixUserContext(prompt: string, ctx: UserContext | null | undefined): string {
  if (!ctx || !ctx.name) return prompt;
  return `${formatUserContext(ctx)}\n\n${prompt}`;
}

export function requesterLine(ctx: UserContext): string {
  const bio = foldBio(ctx.bio);
  return bio ? `요청자: ${ctx.name} — ${bio}` : `요청자: ${ctx.name}`;
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
  return [body ?? "", "", requesterLine(ctx)].join("\n").trim();
}
