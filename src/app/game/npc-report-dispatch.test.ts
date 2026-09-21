import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeReport,
  EMPTY_REPORT_ACK,
  pendingReports,
  type ReportItem,
} from "@/game/report-queue";

import type { RoomMessage, RoomSummary } from "@/lib/chat-rooms-policy";

import {
  activeReportReleased,
  decideReportCall,
  dismissReport,
  dismissedReportIds,
  DISMISSED_REPORT_REVIVE_MS,
  recallReport,
  reviveDismissedReports,
  settleReturningNpcs,
  missedReportArrival,
  reportAckKey,
  npcSignature,
  reconcileReportAttempts,
  releaseUnacquiredReportCalls,
  reportCallBlocked,
  reportsForChannel,
  reportTarget,
  type ReportAttempt,
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
  summary: "",
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
      activeMessageId: null,
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
      activeMessageId: null,
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
      activeMessageId: null,
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
      activeMessageId: "a",
      attempts: [sent("a")],
      signatures: {},
      blocked: false,
    }),
    null,
  );
});

test("전하던 보고가 끝나 큐에서 빠지면 다음 보고를 부른다", () => {
  assert.equal(
    decideReportCall({
      queue: [B],
      activeMessageId: "a",
      attempts: [sent("a")],
      signatures: {},
      blocked: false,
    })?.messageId,
    "b",
  );
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
      acknowledged: EMPTY_REPORT_ACK,
    }),
    [],
  );
});

test("사무실 방의 알림만 본다 — 그룹 방 알림은 보고가 아니다", () => {
  const queue = reportsForChannel({
    rooms: [room("office", "office"), room("g", "group")],
    messages: { office: [notice("a", "npc-1")], g: [notice("b", "npc-1")] },
    npcs: [{ id: "npc-1", active: true }],
    acknowledged: EMPTY_REPORT_ACK,
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
      acknowledged: EMPTY_REPORT_ACK,
    }),
    [],
  );
});

test("거절된 보고는 건너뛰고 다음 직원을 부른다 — 맨 앞이 큐 전체를 막지 않는다", () => {
  // sophie 의 호출이 거절되면 activeMessageId 가 비고, 그 항목은 calledMessageIds 에 남는다.
  // 예전에는 여기서 큐가 멈춰 noah 가 영영 걸어오지 못했다.
  const next = decideReportCall({
    queue: [A, B],
    activeMessageId: null,
    attempts: [sent("a")],
    signatures: {},
    blocked: false,
  });
  assert.equal(next?.messageId, "b");
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeMessageId: null,
      attempts: [sent("a"), sent("b")],
      signatures: {},
      blocked: false,
    }),
    null,
    "전부 호출했으면 더 부르지 않는다",
  );
});

test("전하는 중인 보고가 있으면 그 보고가 우선이고 재호출은 하지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeMessageId: "b",
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
      activeMessageId: "a",
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
      activeMessageId: null,
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
      activeMessageId: null,
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
      activeMessageId: null,
      attempts: [rejected("a", "idle:sock-1"), rejected("b", "idle:sock-1")],
      signatures: { "npc-1": "idle:sock-1" },
      blocked: false,
    }),
    null,
  );
  assert.equal(
    decideReportCall({
      queue: [A, same],
      activeMessageId: null,
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
      activeMessageId: null,
      attempts: [sent("a", "idle:sock-1")],
      signatures: { "npc-1": "walking:mine" },
      blocked: false,
    }),
    null,
    "낙관적 표시는 같은 보고를 두 번 쏘는 것을 막는 장치다 — 결과가 오기 전에는 유지한다",
  );
});

// ---------------------------------------------------------------------------
// 회의실에 있는 동안에는 보고하러 부르지 않는다.
//
// 자동 보고 호출은 직원을 **내 호출**에 묶는다. 묶인 직원은 회의 집결이 원위치를 캡처하지
// 못해 "참가자를 찾을 수 없습니다" 로 집결이 깨졌다 — 밀린 보고가 있으면 회의를 시작할 수
// 없었다(스테이징 실측). 큐는 그대로 남고 회의실을 나오면 이어진다.
// ---------------------------------------------------------------------------

test("회의실에 있으면 보고 호출이 막힌다 — 대화창·칸반·크론과 같은 자리", () => {
  const base = { dialogOpen: false, kanbanOpen: false, cronOpen: false, inMeeting: false };
  assert.equal(reportCallBlocked(base), false);
  assert.equal(reportCallBlocked({ ...base, inMeeting: true }), true, "회의 중에 직원을 부른다");
  assert.equal(reportCallBlocked({ ...base, dialogOpen: true }), true);
  assert.equal(reportCallBlocked({ ...base, kanbanOpen: true }), true);
  assert.equal(reportCallBlocked({ ...base, cronOpen: true }), true);
});

test("회의 중에 막힌 보고는 큐에 남아 회의실을 나오면 다시 후보가 된다", () => {
  const queue = [item("m1", "n1", "2026-09-21T10:00:00.000Z")];
  const during = decideReportCall({
    queue,
    activeMessageId: null,
    attempts: [],
    signatures: {},
    blocked: reportCallBlocked({
      dialogOpen: false,
      kanbanOpen: false,
      cronOpen: false,
      inMeeting: true,
    }),
  });
  assert.equal(during, null);
  const after = decideReportCall({
    queue,
    activeMessageId: null,
    attempts: [],
    signatures: {},
    blocked: reportCallBlocked({
      dialogOpen: false,
      kanbanOpen: false,
      cronOpen: false,
      inMeeting: false,
    }),
  });
  assert.equal(after?.messageId, "m1", "회의가 끝났는데 보고가 사라졌다");
});

// ---------------------------------------------------------------------------
// 회의가 끝나고 돌아와도 보고하러 오지 않던 두 경로.
//
// 재시도는 "직원 상태가 거절 당시와 달라졌다" 로만 일어난다. 그런데 회의 전후로 직원의
// 상태는 **같은 모양으로 돌아온다** — 회의석에 앉은 직원도, 자리로 돌아온 직원도
// `idle` · 주인 없음이다. 그래서 상태가 한 바퀴 돌아도 "달라졌다" 가 보이지 않았다.
// ---------------------------------------------------------------------------

test("서명은 자기 자리에 있는지를 가른다 — 회의석의 idle 과 집의 idle 은 다르다", () => {
  assert.notEqual(
    npcSignature("idle", undefined, "me", false),
    npcSignature("idle", undefined, "me", true),
    "회의석과 집을 같은 상태로 본다 — 복귀가 끝나도 재시도가 일어나지 않는다",
  );
});

test("경로 2 — 회의가 끝나는 순간 낡은 상태로 거절된 호출도, 집에 돌아오면 다시 부른다", () => {
  const queue = [item("m1", "n1", "2026-09-21T10:00:00.000Z")];
  // 회의실을 나온 직후: 화면은 아직 "회의석에 앉은 idle" 인데 서버는 이미 복귀를 시작해
  // `meeting_reserved` 로 거절했다. 기록되는 서명은 화면이 본 회의석 상태다.
  const atMeetingSeat = npcSignature("idle", undefined, "me", false);
  const attempts = [{ messageId: "m1", outcome: "rejected" as const, signature: atMeetingSeat }];
  const home = npcSignature("idle", undefined, "me", true);
  const next = decideReportCall({
    queue,
    activeMessageId: null,
    attempts,
    signatures: { n1: home },
    blocked: false,
  });
  assert.equal(next?.messageId, "m1", "집에 돌아왔는데 다시 부르지 않는다");
});

test("경로 1 — 내 호출로 오던 직원을 누가 가져가면, 보낸 시도를 거절로 바꿔 다시 부를 수 있게 한다", () => {
  const sentAt = npcSignature("idle", undefined, "me", true);
  let attempts: ReportAttempt[] = [{ messageId: "m1", outcome: "sent", signature: sentAt }];

  // 아직 내 것이 되기 전(스냅샷이 오기 전)에는 건드리지 않는다 — 방금 보낸 호출을 잃은 것으로 보면 안 된다.
  attempts = reconcileReportAttempts(attempts, { n1: sentAt }, queueOf("m1", "n1"));
  assert.equal(attempts[0].outcome, "sent");

  // 내 호출로 걸어오는 중.
  const mine = npcSignature("moving-to-player", "me", "me", false);
  attempts = reconcileReportAttempts(attempts, { n1: mine }, queueOf("m1", "n1"));
  assert.equal(attempts[0].outcome, "sent");

  // 회의가 데려갔다 — 더 이상 내 것이 아니다.
  const taken = npcSignature("moving-to-player", "leader", "me", false);
  attempts = reconcileReportAttempts(attempts, { n1: taken }, queueOf("m1", "n1"));
  assert.equal(attempts[0].outcome, "rejected", "빼앗긴 호출이 영영 '보냄' 으로 남는다");
  assert.equal(attempts[0].signature, taken);

  // 회의가 끝나 집에 돌아오면 다시 후보가 된다.
  const next = decideReportCall({
    queue: queueOf("m1", "n1"),
    activeMessageId: null,
    attempts,
    signatures: { n1: npcSignature("idle", undefined, "me", true) },
    blocked: false,
  });
  assert.equal(next?.messageId, "m1");
});

function queueOf(messageId: string, npcId: string) {
  return [item(messageId, npcId, "2026-09-21T10:00:00.000Z")];
}

test("대화창을 확인 없이 닫으면 보고 중인 직원이 큐 전체를 막는다 — 닫힌 보고를 풀면 다음으로 넘어간다", () => {
  const queue = [
    item("m1", "sophie", "2026-09-21T01:00:00Z"),
    item("m2", "oliver", "2026-09-21T02:00:00Z"),
  ];
  const signatures = { sophie: "waiting:mine:away", oliver: "idle:none:home" };
  const attempts: ReportAttempt[] = [{ ...sent("m1", "idle:none:home"), acquired: true }];
  // 재현: 소피가 도착해 대기, 시도는 "보냄" — 올리버도 부르지 않는다.
  assert.equal(
    decideReportCall({ queue, activeMessageId: "m1", attempts, signatures, blocked: false }),
    null,
  );
  const next = decideReportCall({
    queue,
    activeMessageId: null,
    attempts: dismissReport(attempts, "m1", 0),
    signatures,
    blocked: false,
  });
  assert.equal(next?.messageId, "m2");
});

test("닫은 보고 한 건만 접는다 — 같은 직원의 다음 보고는 시간순 차례에 온다", () => {
  const queue = [
    item("m1", "sophie", "2026-09-21T01:00:00Z"),
    item("m2", "sophie", "2026-09-21T02:00:00Z"),
  ];
  const attempts = dismissReport([sent("m1")], "m1", 0);
  assert.deepEqual(
    attempts.map((a) => [a.messageId, a.outcome]),
    [["m1", "dismissed"]],
  );
  assert.equal(
    decideReportCall({ queue, activeMessageId: null, attempts, signatures: {}, blocked: false })
      ?.messageId,
    "m2",
  );
});

test("도착 신호를 놓치고 내 곁에서 기다리는 직원은 대화창을 대신 연다 — 한 번만", () => {
  const queue = [item("m1", "sophie", "2026-09-21T01:00:00Z")];
  const signatures = { sophie: "waiting:mine:away" };
  const attempts: ReportAttempt[] = [{ ...sent("m1"), acquired: true }];
  const input = { queue, activeMessageId: "m1", attempts, signatures, blocked: false };
  assert.equal(missedReportArrival(input)?.messageId, "m1");
  assert.equal(missedReportArrival({ ...input, blocked: true }), null);
  assert.equal(
    missedReportArrival({ ...input, attempts: [{ ...attempts[0], opened: true }] }),
    null,
  );
  // 아직 걸어오는 중이면 기다린다.
  assert.equal(
    missedReportArrival({ ...input, signatures: { sophie: "moving-to-player:mine:away" } }),
    null,
  );
  assert.equal(missedReportArrival({ ...input, activeMessageId: null }), null);
});

// 단테 결정(2026-09-21): 큐 시간순 우선 · 건 단위 확인 · 복귀 = 확인.

const officeRoom = {
  id: "office",
  kind: "office" as const,
  name: "사무실",
  replyPolicy: "mention" as const,
  createdBy: "u1",
  lastMessageAt: null,
  members: [],
};
const reportMessage = (id: string, npcId: string, createdAt: string): RoomMessage => ({
  id,
  roomId: "office",
  senderKind: "npc",
  senderId: npcId,
  senderName: npcId,
  content: `${id} 결과 요약`,
  createdAt,
  notice: { kind: "card_review", cardId: `c-${id}`, cardTitle: id, boardSlug: "b", npcName: npcId },
});
// 소피(목차) → 올리버(본문) → 소피(검수) — 스테이징에서 올리버가 오지 못했던 큐.
const interleaved = [
  reportMessage("toc", "sophie", "2026-09-21T01:00:00Z"),
  reportMessage("body", "oliver", "2026-09-21T02:00:00Z"),
  reportMessage("review", "sophie", "2026-09-21T03:00:00Z"),
];
const interleavedQueue = (acknowledged = EMPTY_REPORT_ACK) =>
  reportsForChannel({
    rooms: [officeRoom],
    messages: { office: interleaved },
    npcs: [
      { id: "sophie", active: true },
      { id: "oliver", active: true },
    ],
    acknowledged,
  });

test("교차 큐 — 소피의 첫 보고가 확인되면 둘째는 소피가 아니라 올리버가 온다", () => {
  const queue = interleavedQueue(acknowledgeReport(EMPTY_REPORT_ACK, "toc"));
  const next = decideReportCall({
    queue,
    // 방금까지 소피가 보고하던 중이었다 — 그래도 새치기하지 않는다.
    activeMessageId: "toc",
    attempts: [{ ...sent("toc"), acquired: true }],
    signatures: { sophie: "waiting:mine:away", oliver: "idle:none:home" },
    blocked: false,
  });
  assert.equal(next?.messageId, "body");
  assert.equal(next?.npcId, "oliver");
});

test("한 건 확인은 다른 직원의 보고를 확인하지 않는다 — 뒤의 보고를 확인해도 앞의 올리버 보고가 남는다", () => {
  const queue = interleavedQueue(acknowledgeReport(EMPTY_REPORT_ACK, "review"));
  assert.deepEqual(
    queue.map((entry) => entry.messageId),
    ["toc", "body"],
  );
});

test("복귀 = 그 보고를 확인 — 같은 보고로 재호출되지 않고 다음 보고로 넘어간다", () => {
  // 복귀 핸들러는 전하던 보고를 `acknowledgeReport` 로 확인하고 전하던 보고를 비운다.
  const queue = interleavedQueue(acknowledgeReport(EMPTY_REPORT_ACK, "toc"));
  const next = decideReportCall({
    queue,
    activeMessageId: null,
    attempts: [],
    // 집에 돌아와 상태가 바뀐 소피 — 예전에는 이 순간 같은 보고로 다시 불렸다.
    signatures: { sophie: "idle:none:home", oliver: "idle:none:home" },
    blocked: false,
  });
  assert.equal(next?.messageId, "body");
  assert.ok(!queue.some((entry) => entry.messageId === "toc"));
});

test("보고 항목은 대화창 요약에 쓸 알림 본문을 싣는다", () => {
  assert.equal(interleavedQueue()[0].summary, "toc 결과 요약");
  assert.equal(
    pendingReports(interleaved, EMPTY_REPORT_ACK, ["oliver"])[0].summary,
    "body 결과 요약",
  );
});

// …75v1A — 서버가 돌려보낸(사용자 조작 없는) 복귀 뒤 큐가 멈추던 두 경로.

test("자동 복귀 — 전하던 보고가 거절로 바뀌면 그 보고가 큐를 쥐지 않고 다음 보고가 호출된다", () => {
  const queue = [
    item("m1", "oliver", "2026-09-21T01:00:00Z"),
    item("m2", "sophie", "2026-09-21T02:00:00Z"),
  ];
  // 올리버가 돌아가는 중(away)에 소유를 잃었다 — 거절 서명은 그 순간의 것이다.
  const attempts = reconcileReportAttempts(
    [{ ...sent("m1"), acquired: true }],
    { oliver: "returning:none:away", sophie: "idle:none:home" },
    queue,
  );
  assert.equal(attempts[0].outcome, "rejected");
  assert.equal(activeReportReleased(attempts, "m1"), true);
  assert.equal(
    decideReportCall({
      queue,
      activeMessageId: "m1",
      attempts,
      signatures: { oliver: "returning:none:away", sophie: "idle:none:home" },
      blocked: false,
    })?.messageId,
    "m2",
  );
});

test("자동 복귀 — 소유를 잃은 순간 이미 집이면 서명이 더 바뀌지 않아도 즉시 재후보가 된다", () => {
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  const signatures = { oliver: "idle:none:home" };
  const attempts = reconcileReportAttempts([{ ...sent("m1"), acquired: true }], signatures, queue);
  assert.equal(attempts[0].outcome, "rejected");
  assert.equal(
    decideReportCall({ queue, activeMessageId: "m1", attempts, signatures, blocked: false })
      ?.messageId,
    "m1",
  );
});

test("자동 복귀 — 돌아가는 중에 거절된 보고는 집에 닿아 서명이 바뀌면 다시 부른다", () => {
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  const attempts = reconcileReportAttempts(
    [{ ...sent("m1"), acquired: true }],
    { oliver: "returning:none:away" },
    queue,
  );
  const decide = (signature: string) =>
    decideReportCall({
      queue,
      activeMessageId: null,
      attempts,
      signatures: { oliver: signature },
      blocked: false,
    });
  assert.equal(decide("returning:none:away"), null, "아직 돌아가는 중이면 기다린다");
  assert.equal(decide("idle:none:home")?.messageId, "m1");
});

// …75v1A ③ — 접힌 보고의 자동 재후보(단테 결정: 다른 보고 확인 또는 약 10분).

test("접힌 보고는 약 10분이 지나면 다시 후보가 된다", () => {
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  const attempts = dismissReport([], "m1", 1_000);
  const decide = (a: ReportAttempt[]) =>
    decideReportCall({ queue, activeMessageId: null, attempts: a, signatures: {}, blocked: false });
  assert.equal(decide(reviveDismissedReports(attempts, 1_000 + 60_000, null)), null);
  assert.equal(
    decide(reviveDismissedReports(attempts, 1_000 + DISMISSED_REPORT_REVIVE_MS, null))?.messageId,
    "m1",
  );
});

test("접힌 뒤 다른 보고를 확인하면 접힌 보고가 다시 후보가 된다 — 접기 전 확인은 세지 않는다", () => {
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  const attempts = dismissReport([], "m1", 5_000);
  assert.deepEqual(reviveDismissedReports(attempts, 6_000, 4_000), attempts);
  assert.deepEqual(reviveDismissedReports(attempts, 6_000, 5_500), []);
  assert.equal(
    decideReportCall({
      queue,
      activeMessageId: null,
      attempts: reviveDismissedReports(attempts, 6_000, 5_500),
      signatures: {},
      blocked: false,
    })?.messageId,
    "m1",
  );
});

test("다시 부르기는 접힌 보고를 즉시 후보로 만든다 — 막힘 규칙은 그대로", () => {
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  const attempts = recallReport(dismissReport([], "m1", 0), "m1");
  assert.equal(dismissedReportIds(attempts).size, 0);
  const input = { queue, activeMessageId: null, attempts, signatures: {}, blocked: false };
  assert.equal(decideReportCall(input)?.messageId, "m1");
  assert.equal(decideReportCall({ ...input, blocked: true }), null);
});

// 스테이징 실측(34369ac8): 복귀가 보고를 확인하는 순간 같은 직원의 접힌 보고가 되살아나
// 곧바로 다시 불렸고, 그 호출이 복귀를 뒤집어 직원이 곁에 남았다.

test("복귀 중인 직원은 자리에 닿을 때까지 보고 호출 후보가 아니다 — 다음 직원이 온다", () => {
  const queue = [
    item("m1", "oliver", "2026-09-21T01:00:00Z"),
    item("m2", "sophie", "2026-09-21T02:00:00Z"),
  ];
  const input = {
    queue,
    activeMessageId: null,
    attempts: [],
    // 복귀를 누른 직후라 스냅샷은 아직 "내 호출에 대기" 다.
    signatures: { oliver: "waiting:mine:away", sophie: "idle:none:home" },
    blocked: false,
  };
  assert.equal(
    decideReportCall({ ...input, returningNpcIds: new Set(["oliver"]) })?.messageId,
    "m2",
  );
  assert.equal(
    decideReportCall({
      ...input,
      signatures: { oliver: "returning:none:away", sophie: "idle:none:home" },
    })?.messageId,
    "m2",
    "서버 스냅샷이 복귀 중이어도 부르지 않는다",
  );
});

test("복귀한 직원은 자리에 닿으면 다시 후보가 된다", () => {
  const returning = new Set(["oliver"]);
  assert.equal(settleReturningNpcs(returning, { oliver: "waiting:mine:away" }), returning);
  assert.equal(settleReturningNpcs(returning, { oliver: "returning:none:away" }), returning);
  assert.equal(settleReturningNpcs(returning, { oliver: "idle:none:home" }).size, 0);
  const queue = [item("m1", "oliver", "2026-09-21T01:00:00Z")];
  assert.equal(
    decideReportCall({
      queue,
      activeMessageId: null,
      attempts: [],
      signatures: { oliver: "idle:none:home" },
      blocked: false,
      returningNpcIds: settleReturningNpcs(returning, { oliver: "idle:none:home" }),
    })?.messageId,
    "m1",
  );
});

test("ack 전에 끊기면 재연결 뒤 같은 보고가 다시 후보가 된다", () => {
  // 보낸 호출의 응답을 받기 전에 소켓이 끊기면 서버가 그 호출을 받았는지 알 수 없다.
  // 예전에는 "보냄" 으로 남아 새로고침 전까지 그 보고를 다시 부르지 않았다.
  const attempts = releaseUnacquiredReportCalls([sent("a", "idle:none:home")]);
  assert.deepEqual(attempts, [{ messageId: "a", outcome: "rejected", signature: "" }]);
  assert.equal(activeReportReleased(attempts, "a"), true);
  assert.equal(
    decideReportCall({
      queue: [A],
      activeMessageId: null,
      attempts,
      signatures: { "npc-1": "idle:none:home" },
      blocked: false,
    })?.messageId,
    "a",
  );
});

test("획득된 보고는 끊김으로 거절이 되지 않는다 — 이미 와 있는 직원을 다시 부르지 않는다", () => {
  const acquired: ReportAttempt = { ...sent("a", "idle:mine:away"), acquired: true };
  const others: ReportAttempt[] = [
    acquired,
    rejected("b", "idle:sock-1:home"),
    { messageId: "c", outcome: "dismissed", signature: "", dismissedAt: 1 },
  ];
  assert.deepEqual(releaseUnacquiredReportCalls(others), others);
});
