import assert from "node:assert/strict";
import test from "node:test";

import type { ReportItem } from "@/game/report-queue";

import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";

import {
  acknowledgedThrough,
  decideReportCall,
  reportAckKey,
  reportsForChannel,
  reportTarget,
} from "./npc-report-dispatch";

const item = (messageId: string, npcId: string, createdAt: string): ReportItem => ({
  messageId,
  npcId,
  npcName: "소피",
  kind: "card_review",
  cardId: `c-${messageId}`,
  boardSlug: "b",
  jobId: null,
  cardTitle: messageId,
  createdAt,
});

const sent = (messageId: string, signature = "idle:none") => ({
  messageId,
  outcome: "sent" as const,
  signature,
});
const rejected = (messageId: string, signature: string) => ({
  messageId,
  outcome: "rejected" as const,
  signature,
});

const A = item("a", "npc-1", "2026-09-21T00:00:01.000Z");
const B = item("b", "npc-2", "2026-09-21T00:00:02.000Z");

test("큐가 비어 있으면 아무도 부르지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [],
      activeNpcId: null,
      attempts: [],
      signatures: {},
      blocked: false,
    }),
    null,
  );
});

test("맨 앞 보고의 NPC 를 부른다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: null,
      attempts: [],
      signatures: {},
      blocked: false,
    })?.messageId,
    "a",
  );
});

test("대화창·모달이 열려 있으면 부르지 않는다 — 큐는 남는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: null,
      attempts: [],
      signatures: {},
      blocked: true,
    }),
    null,
  );
});

test("이미 호출을 쏜 보고는 다시 부르지 않는다 — 걸어오는 중에 재호출하지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: "npc-1",
      attempts: [sent("a")],
      signatures: {},
      blocked: false,
    }),
    null,
  );
});

test("보고 중인 NPC 의 보고가 끝나 큐에서 빠지면 다음 사람을 부른다", () => {
  assert.equal(
    decideReportCall({
      queue: [B],
      activeNpcId: "npc-1",
      attempts: [sent("a")],
      signatures: {},
      blocked: false,
    })?.messageId,
    "b",
  );
});

test("확인 지점은 그 보고까지 포함해 앞선 것을 모두 덮는다", () => {
  assert.equal(acknowledgedThrough(null, B), "2026-09-21T00:00:02.000Z");
  assert.equal(
    acknowledgedThrough("2026-09-21T00:00:05.000Z", B),
    "2026-09-21T00:00:05.000Z",
    "이미 더 뒤까지 확인했으면 되돌리지 않는다",
  );
  assert.equal(acknowledgedThrough("2026-09-21T00:00:01.000Z", B), "2026-09-21T00:00:02.000Z");
});

test("확인 지점 저장 키는 채널마다 다르다", () => {
  assert.equal(reportAckKey("ch-1"), "deskrpg.reportAck.ch-1");
  assert.notEqual(reportAckKey("ch-1"), reportAckKey("ch-2"));
});

const room = (id: string, kind: "office" | "group"): RoomSummary => ({
  id,
  kind,
  name: id,
  replyPolicy: "mention",
  createdBy: "u",
  lastMessageAt: null,
  members: [],
});

const notice = (id: string, npcId: string): RoomMessage => ({
  id,
  roomId: "office",
  senderKind: "npc",
  senderId: npcId,
  senderName: "소피",
  content: "카드",
  createdAt: "2026-09-21T00:00:01.000Z",
  notice: {
    kind: "card_review",
    cardId: `c-${id}`,
    cardTitle: "계약서",
    boardSlug: "b",
    npcName: "소피",
  },
});

test("사무실 방이 아직 없으면 빈 큐다 — 접속 직후 목록이 오기 전", () => {
  assert.deepEqual(
    reportsForChannel({
      rooms: [room("g", "group")],
      messages: { g: [notice("a", "npc-1")] },
      npcs: [{ id: "npc-1", active: true }],
      acknowledgedAt: null,
    }),
    [],
  );
});

test("사무실 방의 알림만 본다 — 그룹 방 알림은 보고가 아니다", () => {
  const queue = reportsForChannel({
    rooms: [room("office", "office"), room("g", "group")],
    messages: { office: [notice("a", "npc-1")], g: [notice("b", "npc-1")] },
    npcs: [{ id: "npc-1", active: true }],
    acknowledgedAt: null,
  });
  assert.deepEqual(
    queue.map((item) => item.messageId),
    ["a"],
  );
});

test("잠든 NPC 의 보고는 큐에 넣지 않는다 — 걸어올 수 없다", () => {
  assert.deepEqual(
    reportsForChannel({
      rooms: [room("office", "office")],
      messages: { office: [notice("a", "npc-1")] },
      npcs: [{ id: "npc-1", active: false }],
      acknowledgedAt: null,
    }),
    [],
  );
});

test("거절된 보고는 건너뛰고 다음 직원을 부른다 — 맨 앞이 큐 전체를 막지 않는다", () => {
  // sophie 의 호출이 거절되면 activeNpcId 가 비고, 그 항목은 calledMessageIds 에 남는다.
  // 예전에는 여기서 큐가 멈춰 noah 가 영영 걸어오지 못했다.
  const next = decideReportCall({
    queue: [A, B],
    activeNpcId: null,
    attempts: [sent("a")],
    signatures: {},
    blocked: false,
  });
  assert.equal(next?.messageId, "b");
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: null,
      attempts: [sent("a"), sent("b")],
      signatures: {},
      blocked: false,
    }),
    null,
    "전부 호출했으면 더 부르지 않는다",
  );
});

test("보고 중인 직원이 있으면 그 사람이 우선이고 재호출은 하지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: "npc-2",
      attempts: [],
      signatures: {},
      blocked: false,
    })?.messageId,
    "b",
    "보고 중인 쪽을 먼저 돌려준다",
  );
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: "npc-1",
      attempts: [sent("a")],
      signatures: {},
      blocked: false,
    }),
    null,
    "보고 중인 직원을 이미 불렀으면 다시 부르지 않는다 — 걸어오는 중이다",
  );
});

test("보고를 열 곳은 종류로 갈린다 — 크론 실패는 카드가 아니다", () => {
  assert.deepEqual(reportTarget(A), { kind: "card", cardId: "c-a" });
  assert.deepEqual(
    reportTarget({ ...A, kind: "cron_failed", cardId: null, boardSlug: null, jobId: "job-7" }),
    { kind: "cron", jobId: "job-7" },
  );
  assert.equal(
    reportTarget({ ...A, cardId: null, jobId: null }),
    null,
    "열 곳이 없으면 null — 빈 id 로 엉뚱한 모달을 열지 않는다",
  );
});

test("거절된 보고는 그 직원의 상태가 그대로인 동안 다시 부르지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A],
      activeNpcId: null,
      attempts: [rejected("a", "idle:sock-1")],
      signatures: { "npc-1": "idle:sock-1" },
      blocked: false,
    }),
    null,
    "상태가 같으면 결과도 같다 — 매 렌더마다 호출이 나가면 안 된다",
  );
});

test("거절된 보고는 그 직원의 상태가 바뀌면 다시 후보가 된다", () => {
  // 실측 시나리오: 이긴 탭이 떠나며 소유권이 이 탭으로 넘어온다(`idle:sock-1` → `idle:mine`).
  // 예전에는 여기서 영영 다시 부르지 않아, 새로고침해야만 직원이 걸어왔다.
  assert.equal(
    decideReportCall({
      queue: [A],
      activeNpcId: null,
      attempts: [rejected("a", "idle:sock-1")],
      signatures: { "npc-1": "idle:mine" },
      blocked: false,
    })?.messageId,
    "a",
  );
});

test("미확인 보고가 전부 같은 직원 것이어도 상태가 바뀌면 되살아난다", () => {
  // 큐 전진만으로는 못 구하던 경우 — 실측에서 소피의 보고 둘이 함께 막혀 있었다.
  const same = { ...B, npcId: "npc-1" };
  assert.equal(
    decideReportCall({
      queue: [A, same],
      activeNpcId: null,
      attempts: [rejected("a", "idle:sock-1"), rejected("b", "idle:sock-1")],
      signatures: { "npc-1": "idle:sock-1" },
      blocked: false,
    }),
    null,
  );
  assert.equal(
    decideReportCall({
      queue: [A, same],
      activeNpcId: null,
      attempts: [rejected("a", "idle:sock-1"), rejected("b", "idle:sock-1")],
      signatures: { "npc-1": "idle:mine" },
      blocked: false,
    })?.messageId,
    "a",
    "되살아나면 발생 순서대로 맨 앞부터",
  );
});

test("응답을 기다리는 중인 보고(sent)는 상태가 바뀌어도 다시 부르지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A],
      activeNpcId: null,
      attempts: [sent("a", "idle:sock-1")],
      signatures: { "npc-1": "walking:mine" },
      blocked: false,
    }),
    null,
    "낙관적 표시는 같은 보고를 두 번 쏘는 것을 막는 장치다 — 결과가 오기 전에는 유지한다",
  );
});
