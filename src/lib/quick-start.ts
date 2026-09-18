import { defaultOfficeAppearance, type CharacterAppearance } from "@/game/three/office-appearance";

/**
 * 빠른 시작의 **순수 로직**. DB 도 `fetch` 도 여기 들어오지 않는다 — 라우트가
 * 기존 도메인 함수(캐릭터/채널/배치 라우트)를 부르고, 이 파일은 "무엇을 만들지"
 * 같은 결정만 한다.
 *
 * 새 도메인 규칙을 만들지 않는 것이 이 기능의 핵심 제약이다. 자리 배정은
 * `npc-seating.ts` 가 한다 — 여기에는 없다.
 */

/** 채널 생성 화면의 기본 선택과 같은 오피스 환경. */
export const QUICK_START_ENVIRONMENT_ID = "trading";

/** 기본 외형. 첫 번째 남성 룩(`office-jun`) — 캐릭터 생성 초기값과 같다. */
export const QUICK_START_APPEARANCE: CharacterAppearance = defaultOfficeAppearance();

const MAX_CHARACTER_NAME = 50;
const MAX_CHANNEL_NAME = 100;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** 캐릭터 이름은 닉네임을 그대로 쓴다 — 없거나 너무 길면 접는다. */
export function quickStartCharacterName(nickname: string | null | undefined): string {
  const base = clean(nickname);
  return (base || "Player").slice(0, MAX_CHARACTER_NAME);
}

/** 채널 이름도 마찬가지. 사무실은 한 사람당 하나면 충분하다. */
export function quickStartChannelName(nickname: string | null | undefined): string {
  const base = clean(nickname);
  return (base ? `${base}'s Office` : "My Office").slice(0, MAX_CHANNEL_NAME);
}

/** 빠른 시작이 끝나고 브라우저가 갈 곳. 캐릭터는 싣지 않는다 — "나" 는 서버가 정한다. */
export function quickStartGamePath(input: { channelId: string }): string {
  const params = new URLSearchParams({ channelId: input.channelId });
  return `/game?${params.toString()}`;
}
