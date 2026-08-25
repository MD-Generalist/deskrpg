// NPC 1:1 대화 이력의 저장소.
//
// 이력의 소유 단위는 **캐릭터**다 — `chat_messages` 스키마의 (character_id, npc_id) 그대로.
// 같은 채널에 있어도 내가 NPC 와 나눈 대화는 나만 본다. 소켓 핸들러의 인메모리 맵은
// 이 저장소 앞의 캐시일 뿐이고, 프로세스가 죽으면 여기 남은 것이 정본이다.

import { and, asc, eq } from "drizzle-orm";

export type NpcHistoryRole = "player" | "npc";

export type NpcHistoryMessage = {
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
// (src/lib/task-reporting.ts 참고): db·schema 를 unknown 으로 받아 안에서 좁힌다.

type ChatDb = {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => { orderBy: (order: unknown) => Promise<StoredChatMessage[]> };
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
  return toHistoryMessages(rows);
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
