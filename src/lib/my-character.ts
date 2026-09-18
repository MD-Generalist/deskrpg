/**
 * "내 캐릭터" 는 사용자당 하나다 — 이 사용자 자신이다(스펙 2026-09-18).
 *
 * DB 에는 예전 다중 캐릭터가 남아 있을 수 있어 유일 제약을 걸지 않는다. 대신 **가장 이른 캐릭터**를
 * "나" 로 삼고 나머지는 보존만 한다. 이 규칙은 여기 한 곳에만 있다 — API·페이지·소켓이 전부 이 함수를 쓴다.
 */
import { asc, eq } from "drizzle-orm";

import { characters, db, jsonForDb, nowForDb } from "@/db";
import { parseDbJson } from "@/lib/db-json";
import { BIO_MAX_LENGTH } from "@/lib/my-character-limits";
import { QUICK_START_APPEARANCE, quickStartCharacterName } from "@/lib/quick-start";

export { BIO_MAX_LENGTH };

export type MyCharacter = { id: string; name: string; bio: string | null; appearance: unknown };

export async function getMyCharacter(userId: string): Promise<MyCharacter | null> {
  const [row] = await db
    .select({
      id: characters.id,
      name: characters.name,
      bio: characters.bio,
      appearance: characters.appearance,
    })
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.createdAt), asc(characters.id))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    bio: row.bio ?? null,
    appearance: parseDbJson(row.appearance) ?? row.appearance,
  };
}

export async function ensureMyCharacter(
  userId: string,
  nickname: string | null,
): Promise<MyCharacter> {
  const existing = await getMyCharacter(userId);
  if (existing) return existing;
  const [created] = await db
    .insert(characters)
    .values({
      userId,
      name: quickStartCharacterName(nickname),
      appearance: jsonForDb(QUICK_START_APPEARANCE),
      updatedAt: nowForDb(),
    })
    .returning({
      id: characters.id,
      name: characters.name,
      bio: characters.bio,
      appearance: characters.appearance,
    });
  return { ...created, bio: created.bio ?? null, appearance: QUICK_START_APPEARANCE };
}

export function isMyCharacter(mine: MyCharacter | null, characterId: string): boolean {
  return !!mine && mine.id === characterId;
}

/** `bio` 입력 검증 — POST/PATCH 공용. 빈 값은 null 로, 2,000자 초과는 거절한다. */
export function validateBio(
  value: unknown,
):
  | { ok: true; bio: string | null }
  | { ok: false; errorCode: "character_bio_too_long" | "character_bio_invalid" } {
  if (value === undefined || value === null || value === "") return { ok: true, bio: null };
  if (typeof value !== "string") return { ok: false, errorCode: "character_bio_invalid" };
  if (value.length > BIO_MAX_LENGTH) return { ok: false, errorCode: "character_bio_too_long" };
  return { ok: true, bio: value.trim() || null };
}
