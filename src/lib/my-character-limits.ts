/**
 * 내 캐릭터 소개(bio) 상한. DB 의존이 없는 상수만 둔다 — 클라이언트 폼과 서버 검증,
 * 대화 앞머리 주입(user-context.ts)이 같은 값을 쓰게 하려고 my-character.ts 에서 떼어 냈다.
 */
export const BIO_MAX_LENGTH = 2000;
