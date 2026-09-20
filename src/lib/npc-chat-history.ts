// NPC 1:1 대화 이력의 저장소.
//
// 이력의 소유 단위는 **캐릭터**다 — `chat_messages` 스키마의 (character_id, npc_id) 그대로.
// 같은 채널에 있어도 내가 NPC 와 나눈 대화는 나만 본다. 소켓 핸들러의 인메모리 맵은
// 이 저장소 앞의 캐시일 뿐이고, 프로세스가 죽으면 여기 남은 것이 정본이다.

import { and, asc, eq } from "drizzle-orm";

import { summarizeDmThreads, type DmThread, type DmThreadRow } from "./dm-threads";

export type NpcHistoryRole = "player" | "npc";

export type NpcHistoryMessage = {
  /** Transient correlation IDs; retained alongside receipts until server restart. */
  id?: string;
  responseRequestId?: string;
  role: NpcHistoryRole;
  content: string;
  timestamp: number;
};

export type StoredChatMessage = {
  role: string;
  content: string;
  createdAt: Date | null;
};

export type NpcChatMessageRow = {
  characterId: string;
  npcId: string;
  role: NpcHistoryRole;
  content: string;
};

/** 인메모리 캐시 키. 캐릭터별로 갈린다는 사실이 이 한 줄에 모여 있다. */
export function npcHistoryKey(characterId: string, npcId: string): string {
  return `${characterId}:${npcId}`;
}

/**
 * 이 발화를 누구의 이력으로 남길지 정한다.
 *
 * 소켓이 붙어 있고 화면도 멀쩡한데 서버의 `players` 에는 없는 구간이 있다 — 재연결
 * 직후 `player:join` 이 다시 성립하기 전이 그렇다(배포·네트워크 끊김 뒤). 그 동안 오간
 * 대화는 서버가 캐릭터를 몰라 통째로 사라졌다 — 응답까지 정상이라 화면은 성공을 보여주고
 * 기록만 없는, 조용한 유실이다.
 *
 * 그래서 클라이언트가 자기 캐릭터를 함께 실어 보낸다. 다만 클라이언트가 말한 값은
 * 그대로 믿지 않는다. 서버가 이미 아는 값(join 된 소켓)이 있으면 그쪽이 이기고,
 * 없을 때만 클라이언트의 주장을 쓰되 소유를 확인하라고 표시한다.
 */
export function pickHistoryCharacterId(input: {
  joinedCharacterId: string | null;
  claimedCharacterId: string | null;
}): { characterId: string | null; needsVerification: boolean } {
  const joined = input.joinedCharacterId?.trim();
  if (joined) return { characterId: joined, needsVerification: false };

  const claimed = input.claimedCharacterId?.trim();
  if (claimed) return { characterId: claimed, needsVerification: true };

  return { characterId: null, needsVerification: false };
}

/** 저장할 값이 없으면 null — 빈 발화로 이력을 더럽히지 않는다. */
export function buildChatMessageRow(input: {
  characterId: string;
  npcId: string;
  role: NpcHistoryRole;
  content: string;
}): NpcChatMessageRow | null {
  const content = input.content.trim();
  if (!content) return null;
  return {
    characterId: input.characterId,
    npcId: input.npcId,
    role: input.role,
    content,
  };
}

function isHistoryRole(role: string): role is NpcHistoryRole {
  return role === "player" || role === "npc";
}

/** 저장된 행을 클라이언트가 이미 알고 있는 이력 모양으로 되돌린다. */
export function toHistoryMessages(rows: StoredChatMessage[]): NpcHistoryMessage[] {
  const messages: NpcHistoryMessage[] = [];
  for (const row of rows) {
    if (!isHistoryRole(row.role)) continue;
    messages.push({
      role: row.role,
      content: row.content,
      // createdAt 이 없다고 메시지를 버리지는 않는다 — 순서는 조회에서 이미 정해졌고,
      // 여기서 잃을 것은 표시용 시각뿐이다.
      timestamp: row.createdAt ? row.createdAt.getTime() : 0,
    });
  }
  return messages;
}

// --- DB 경계 -------------------------------------------------------------
// 이 아래는 drizzle 에 닿는다. 다른 서버 헬퍼들과 같은 주입 방식을 쓴다
// db·schema 를 unknown 으로 받아 안에서 좁힌다.

type ChatDb = {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      // 뽑는 열이 호출마다 달라서(이력 / 목록) 행 모양은 호출 쪽에서 좁힌다.
      where: (cond: unknown) => { orderBy: (...order: unknown[]) => Promise<unknown[]> };
    };
  };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
};

type ChatSchema = {
  chatMessages: {
    characterId: unknown;
    npcId: unknown;
    role: unknown;
    content: unknown;
    createdAt: unknown;
  };
};

function asChatDb(db: unknown): ChatDb {
  return db as ChatDb;
}

function asChatSchema(schema: unknown): ChatSchema {
  return schema as ChatSchema;
}

function ownerCondition(table: ChatSchema["chatMessages"], characterId: string, npcId: string) {
  return and(eq(table.characterId as never, characterId), eq(table.npcId as never, npcId));
}

export async function appendNpcChatMessage(
  db: unknown,
  schema: unknown,
  input: { characterId: string; npcId: string; role: NpcHistoryRole; content: string },
): Promise<NpcChatMessageRow | null> {
  const row = buildChatMessageRow(input);
  if (!row) return null;
  const { chatMessages } = asChatSchema(schema);
  await asChatDb(db).insert(chatMessages).values(row);
  return row;
}

export async function loadNpcChatHistory(
  db: unknown,
  schema: unknown,
  input: { characterId: string; npcId: string },
): Promise<NpcHistoryMessage[]> {
  const { chatMessages } = asChatSchema(schema);
  const rows = await asChatDb(db)
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(ownerCondition(chatMessages, input.characterId, input.npcId))
    .orderBy(asc(chatMessages.createdAt as never));
  return toHistoryMessages(rows as StoredChatMessage[]);
}

/**
 * 이 캐릭터가 대화한 직원들의 **마지막 발화 한 줄씩** 을 뽑는다 — 대화 목록의 DM 줄이다.
 *
 * 한 캐릭터의 DM 행을 모두 읽어 JS 에서 접는다. 정렬을 `(npcId, createdAt)` 로 두어
 * `idx_chat_messages_lookup` 를 그대로 타고, 접는 규칙은 `summarizeDmThreads` 가 갖는다.
 * 행 수는 한 사람이 직원들과 나눈 대화 전체이므로 `loadNpcChatHistory`(한 직원 전체)와
 * 같은 자리수다 — 목록을 열 때 한 번 돈다. 더 커지면 그때 집계 질의로 바꾼다.
 */
export async function loadDmThreads(
  db: unknown,
  schema: unknown,
  input: { characterId: string },
): Promise<DmThread[]> {
  const { chatMessages } = asChatSchema(schema);
  const rows = await asChatDb(db)
    .select({
      npcId: chatMessages.npcId,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.characterId as never, input.characterId))
    .orderBy(asc(chatMessages.npcId as never), asc(chatMessages.createdAt as never));
  return summarizeDmThreads(rows as DmThreadRow[]);
}

export async function clearNpcChatHistory(
  db: unknown,
  schema: unknown,
  input: { characterId: string; npcId: string },
): Promise<void> {
  const { chatMessages } = asChatSchema(schema);
  await asChatDb(db)
    .delete(chatMessages)
    .where(ownerCondition(chatMessages, input.characterId, input.npcId));
}

/**
 * 클라이언트가 실어 보낸 캐릭터가 정말 그 사용자의 것인지 확인한다.
 * 이 검증이 빠지면 남의 characterId 를 실어 그 사람 이력에 쓸 수 있다.
 */
export async function characterBelongsToUser(
  db: unknown,
  schema: unknown,
  input: { characterId: string; userId: string },
): Promise<boolean> {
  const { characters } = schema as { characters: { id: unknown; userId: unknown } };
  const rows = await (
    db as {
      select: (fields?: unknown) => {
        from: (table: unknown) => {
          where: (cond: unknown) => { limit: (n: number) => Promise<unknown[]> };
        };
      };
    }
  )
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.id as never, input.characterId),
        eq(characters.userId as never, input.userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
