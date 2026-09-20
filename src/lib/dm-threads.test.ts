import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDmThreadEntries,
  needsCallBeforeDmSend,
  summarizeDmThreads,
  type DmThreadRow,
} from "./dm-threads";

const at = (iso: string) => new Date(iso);

test("직원별로 마지막 발화 한 줄만 남는다", () => {
  const rows: DmThreadRow[] = [
    { npcId: "n1", role: "player", content: "안녕", createdAt: at("2026-09-01T00:00:00Z") },
    { npcId: "n1", role: "npc", content: "반가워요", createdAt: at("2026-09-01T00:00:10Z") },
  ];
  const threads = summarizeDmThreads(rows);
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].lastMessage, { role: "npc", content: "반가워요" });
  assert.equal(threads[0].lastAt, at("2026-09-01T00:00:10Z").getTime());
});

test("최근 대화가 위로 온다", () => {
  const threads = summarizeDmThreads([
    { npcId: "old", role: "npc", content: "어제", createdAt: at("2026-09-01T00:00:00Z") },
    { npcId: "new", role: "npc", content: "오늘", createdAt: at("2026-09-02T00:00:00Z") },
  ]);
  assert.deepEqual(
    threads.map((thread) => thread.npcId),
    ["new", "old"],
  );
});

test("대화가 없는 직원은 아예 줄이 생기지 않는다", () => {
  assert.deepEqual(summarizeDmThreads([]), []);
});

test("빈 발화와 알 수 없는 역할은 목록을 더럽히지 않는다", () => {
  const threads = summarizeDmThreads([
    { npcId: "n1", role: "player", content: "안녕", createdAt: at("2026-09-01T00:00:00Z") },
    { npcId: "n1", role: "system", content: "내부 기록", createdAt: at("2026-09-01T00:01:00Z") },
    { npcId: "n1", role: "npc", content: "   ", createdAt: at("2026-09-01T00:02:00Z") },
  ]);
  assert.deepEqual(threads[0].lastMessage, { role: "player", content: "안녕" });
});

test("시각이 없는 행도 버리지 않는다", () => {
  const threads = summarizeDmThreads([
    { npcId: "n1", role: "player", content: "안녕", createdAt: null },
  ]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].lastAt, 0);
});

test("퇴근한 직원의 대화는 비활성으로 남는다 — 감추면 입구가 다시 사라진다", () => {
  const entries = buildDmThreadEntries(
    summarizeDmThreads([
      {
        npcId: "n1",
        role: "npc",
        content: "다녀오겠습니다",
        createdAt: at("2026-09-01T00:00:00Z"),
      },
    ]),
    [{ id: "n1", name: "noah", active: false }],
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].npcName, "noah");
  assert.equal(entries[0].active, false);
});

test("명단에 없는(삭제된) 직원의 대화는 목록에서 뺀다", () => {
  const entries = buildDmThreadEntries(
    summarizeDmThreads([
      { npcId: "gone", role: "npc", content: "…", createdAt: at("2026-09-01T00:00:00Z") },
    ]),
    [{ id: "n1", name: "noah", active: true }],
  );
  assert.deepEqual(entries, []);
});

test("곁에 있거나 오는 중이면 다시 부르지 않는다", () => {
  assert.equal(needsCallBeforeDmSend("waiting"), false);
  assert.equal(needsCallBeforeDmSend("moving-to-player"), false);
});

test("자리에 있거나 상태를 모르면 보내는 시점에 부른다", () => {
  assert.equal(needsCallBeforeDmSend(undefined), true);
  assert.equal(needsCallBeforeDmSend(null), true);
  assert.equal(needsCallBeforeDmSend("idle"), true);
  assert.equal(needsCallBeforeDmSend("returning"), true);
});

// dev1 검토 질문: `loadDmThreads` 는 캐릭터의 DM 을 **채널 구분 없이** 읽는다. 다른 채널
// 직원의 줄이 걸러지는 근거는 이 대조뿐이다 — 출근부(`rosterNpcs`)가
// `/api/npcs?channelId=…&roster=1` 로 채널별로 오고, 거기 없는 npcId 는 줄이 되지 않는다.
// 위의 "삭제된 직원" 테스트와 기계적으로 같은 경로지만, 이 경우로 이름을 붙여 둔다 —
// 이름이 없으면 나중에 "채널 격리는 어디서 되나" 를 다시 조사하게 된다.
test("다른 채널 직원과 나눈 대화는 현재 채널 목록에 섞이지 않는다", () => {
  const threads = summarizeDmThreads([
    { npcId: "here", role: "npc", content: "이 채널", createdAt: at("2026-09-01T00:00:00Z") },
    {
      npcId: "elsewhere",
      role: "npc",
      content: "다른 채널",
      createdAt: at("2026-09-02T00:00:00Z"),
    },
  ]);
  // 최신순이라 다른 채널 줄이 먼저 온다 — 그래도 목록에는 남지 않아야 한다.
  assert.deepEqual(
    threads.map((thread) => thread.npcId),
    ["elsewhere", "here"],
  );
  const entries = buildDmThreadEntries(threads, [{ id: "here", name: "noah", active: true }]);
  assert.deepEqual(
    entries.map((entry) => entry.npcId),
    ["here"],
  );
});
