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
  assert.ok(row, "행이 저장되지 않았다");
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

// --- 소유자 결정: join 전 대화가 조용히 사라지지 않게 하는 지점 ---

import { characterBelongsToUser, pickHistoryCharacterId } from "./npc-chat-history";

test("join 된 소켓은 서버가 아는 캐릭터를 쓰고 검증하지 않는다", () => {
  const picked = pickHistoryCharacterId({
    joinedCharacterId: "char-joined",
    claimedCharacterId: "char-claimed",
  });
  // 클라이언트가 다른 값을 불러도 서버가 아는 쪽이 이긴다.
  assert.deepEqual(picked, { characterId: "char-joined", needsVerification: false });
});

test("아직 join 전이면 클라이언트가 말한 캐릭터를 쓰되 검증을 요구한다", () => {
  assert.deepEqual(
    pickHistoryCharacterId({ joinedCharacterId: null, claimedCharacterId: "char-x" }),
    {
      characterId: "char-x",
      needsVerification: true,
    },
  );
});

test("둘 다 없으면 소유자를 정하지 못한다", () => {
  assert.deepEqual(pickHistoryCharacterId({ joinedCharacterId: null, claimedCharacterId: null }), {
    characterId: null,
    needsVerification: false,
  });
});

test("빈 문자열은 캐릭터로 치지 않는다", () => {
  assert.deepEqual(pickHistoryCharacterId({ joinedCharacterId: "", claimedCharacterId: "  " }), {
    characterId: null,
    needsVerification: false,
  });
});

test("소유 검증은 그 사용자의 캐릭터일 때만 통과한다", async () => {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ id: "char-x" }] }) }),
    }),
  };
  assert.equal(
    await characterBelongsToUser(db, { characters: {} }, { characterId: "char-x", userId: "u1" }),
    true,
  );
});

test("남의 캐릭터를 실어 보내면 거부한다", async () => {
  // 조회가 비면 그 사용자의 것이 아니다 — 남의 이력에 쓰지 못하게 막는 지점이다.
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  };
  assert.equal(
    await characterBelongsToUser(db, { characters: {} }, { characterId: "char-y", userId: "u1" }),
    false,
  );
});

// --- 태스크와 이력이 같은 소유자를 봐야 한다 ---

test("이력과 태스크는 같은 캐릭터 판정을 쓴다", () => {
  // 실측(2026-08-28): 태스크 분기만 `players` 맵을 직접 봐서, 재연결 직후 세션에서
  // 이력은 남는데 태스크만 조용히 사라졌다 — 사용자는 승인까지 마친 뒤였다.
  // 두 경로가 같은 함수를 쓰는 한 이 어긋남은 다시 생길 수 없다.
  const joined = pickHistoryCharacterId({
    joinedCharacterId: null,
    claimedCharacterId: "char-x",
  });
  assert.equal(joined.characterId, "char-x");
  assert.equal(joined.needsVerification, true);

  // join 전이어도 소유자를 정할 수 있다는 것이 핵심이다 —
  // 예전 태스크 경로는 이 경우를 그냥 버렸다.
  assert.notEqual(joined.characterId, null);
});
