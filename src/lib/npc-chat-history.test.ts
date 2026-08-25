import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatMessageRow,
  npcHistoryKey,
  toHistoryMessages,
  type StoredChatMessage,
} from "./npc-chat-history";

// --- 키: 이력의 소유 단위가 캐릭터라는 사실을 고정한다 ---

test("이력 키는 캐릭터별로 갈린다", () => {
  // 같은 채널의 두 사람이 같은 NPC 와 나눈 대화는 섞이지 않는다.
  assert.notEqual(npcHistoryKey("char-a", "npc-1"), npcHistoryKey("char-b", "npc-1"));
});

test("같은 캐릭터가 다른 NPC 와 나눈 대화도 갈린다", () => {
  assert.notEqual(npcHistoryKey("char-a", "npc-1"), npcHistoryKey("char-a", "npc-2"));
});

test("같은 캐릭터·같은 NPC 는 같은 키다", () => {
  assert.equal(npcHistoryKey("char-a", "npc-1"), npcHistoryKey("char-a", "npc-1"));
});

// --- 행 빌더 ---

test("행은 캐릭터·NPC·역할·내용을 담는다", () => {
  const row = buildChatMessageRow({
    characterId: "char-a",
    npcId: "npc-1",
    role: "player",
    content: "안녕",
  });
  assert.equal(row.characterId, "char-a");
  assert.equal(row.npcId, "npc-1");
  assert.equal(row.role, "player");
  assert.equal(row.content, "안녕");
});

test("빈 내용은 저장하지 않는다", () => {
  assert.equal(
    buildChatMessageRow({ characterId: "c", npcId: "n", role: "npc", content: "   " }),
    null,
  );
});

// --- DB 행 → 클라이언트 메시지 ---

test("저장된 행을 클라이언트 이력 모양으로 되돌린다", () => {
  const at = new Date("2026-08-26T01:02:03.000Z");
  const rows: StoredChatMessage[] = [
    { role: "player", content: "안녕", createdAt: at },
    { role: "npc", content: "반가워요", createdAt: at },
  ];
  assert.deepEqual(toHistoryMessages(rows), [
    { role: "player", content: "안녕", timestamp: at.getTime() },
    { role: "npc", content: "반가워요", timestamp: at.getTime() },
  ]);
});

test("createdAt 이 비어 있어도 메시지를 잃지 않는다", () => {
  // 부트스트랩으로 만든 행이나 구버전 데이터에 null 이 있을 수 있다.
  const [msg] = toHistoryMessages([{ role: "npc", content: "안녕", createdAt: null }]);
  assert.equal(msg.content, "안녕");
  assert.equal(typeof msg.timestamp, "number");
});

test("알 수 없는 역할은 버린다", () => {
  const rows = [
    { role: "player", content: "ok", createdAt: null },
    { role: "system", content: "내부용", createdAt: null },
  ] as unknown as StoredChatMessage[];
  assert.deepEqual(
    toHistoryMessages(rows).map((m) => m.content),
    ["ok"],
  );
});

// --- DB 경계: 배선이 실제로 도는지 (순수 함수만 고정하면 여기가 빈다) ---

import { appendNpcChatMessage, clearNpcChatHistory, loadNpcChatHistory } from "./npc-chat-history";

const schema = {
  chatMessages: {
    characterId: "col.characterId",
    npcId: "col.npcId",
    role: "col.role",
    content: "col.content",
    createdAt: "col.createdAt",
  },
};

test("append 는 빌드한 행을 그대로 insert 한다", async () => {
  const inserted: unknown[] = [];
  const db = {
    insert: () => ({
      values: async (row: unknown) => {
        inserted.push(row);
      },
    }),
  };
  const row = await appendNpcChatMessage(db, schema, {
    characterId: "char-a",
    npcId: "npc-1",
    role: "player",
    content: "  안녕  ",
  });
  assert.deepEqual(inserted, [
    { characterId: "char-a", npcId: "npc-1", role: "player", content: "안녕" },
  ]);
  assert.equal(row?.content, "안녕");
});

test("빈 발화는 DB 에 닿지도 않는다", async () => {
  let touched = false;
  const db = {
    insert: () => {
      touched = true;
      return { values: async () => {} };
    },
  };
  const row = await appendNpcChatMessage(db, schema, {
    characterId: "char-a",
    npcId: "npc-1",
    role: "npc",
    content: "   ",
  });
  assert.equal(row, null);
  assert.equal(touched, false);
});

test("load 는 조회 결과를 이력 메시지로 돌려준다", async () => {
  const at = new Date("2026-08-26T00:00:00.000Z");
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [{ role: "npc", content: "안녕하세요", createdAt: at }],
        }),
      }),
    }),
  };
  const messages = await loadNpcChatHistory(db, schema, {
    characterId: "char-a",
    npcId: "npc-1",
  });
  assert.deepEqual(messages, [{ role: "npc", content: "안녕하세요", timestamp: at.getTime() }]);
});

test("clear 는 delete 를 부른다", async () => {
  let deleted = false;
  const db = {
    delete: () => ({
      where: async () => {
        deleted = true;
      },
    }),
  };
  await clearNpcChatHistory(db, schema, { characterId: "char-a", npcId: "npc-1" });
  assert.equal(deleted, true);
});
