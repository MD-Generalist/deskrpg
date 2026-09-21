import assert from "node:assert/strict";
import test from "node:test";

import type { RoomMessage } from "@/lib/chat-rooms-policy";

import {
  acknowledgeReport,
  EMPTY_REPORT_ACK,
  parseReportAck,
  pendingReports,
  serializeReportAck,
} from "./report-queue";

const msg = (over: Partial<RoomMessage> & { id: string }): RoomMessage => ({
  roomId: "office",
  senderKind: "npc",
  senderId: "npc-1",
  senderName: "소피",
  content: "카드",
  createdAt: "2026-09-21T00:00:00.000Z",
  notice: null,
  ...over,
});

const card = (
  id: string,
  kind: "card_review" | "card_blocked" | "card_done",
  createdAt: string,
  npcId = "npc-1",
) =>
  msg({
    id,
    senderId: npcId,
    createdAt,
    notice: { kind, cardId: `c-${id}`, cardTitle: `제목 ${id}`, boardSlug: "b", npcName: "소피" },
  });

const present = ["npc-1", "npc-2"];

test("보고 대상은 review·blocked·done 과 실패한 크론뿐이다", () => {
  const messages = [
    card("a", "card_review", "2026-09-21T00:00:01.000Z"),
    card("b", "card_blocked", "2026-09-21T00:00:02.000Z"),
    card("c", "card_done", "2026-09-21T00:00:03.000Z"),
    msg({
      id: "d",
      createdAt: "2026-09-21T00:00:04.000Z",
      notice: { kind: "cron_result", jobId: "j", jobName: "야간", npcName: "소피", status: "ok" },
    }),
    msg({
      id: "e",
      createdAt: "2026-09-21T00:00:05.000Z",
      notice: {
        kind: "cron_result",
        jobId: "j",
        jobName: "야간",
        npcName: "소피",
        status: "error",
      },
    }),
    msg({ id: "f", createdAt: "2026-09-21T00:00:06.000Z" }),
  ];
  assert.deepEqual(
    pendingReports(messages, EMPTY_REPORT_ACK, present).map((r) => r.messageId),
    ["a", "b", "c", "e"],
    "성공한 크론과 일반 메시지는 보고가 아니다",
  );
});

test("발생 순서대로 줄을 세운다 — 목록이 뒤섞여 들어와도", () => {
  const messages = [
    card("late", "card_review", "2026-09-21T00:00:09.000Z"),
    card("early", "card_blocked", "2026-09-21T00:00:01.000Z"),
    card("mid", "card_done", "2026-09-21T00:00:05.000Z"),
  ];
  assert.deepEqual(
    pendingReports(messages, EMPTY_REPORT_ACK, present).map((r) => r.messageId),
    ["early", "mid", "late"],
  );
});

test("확인 시점 이전의 보고는 제외한다 — 그 시점 자체도 확인된 것으로 본다", () => {
  const messages = [
    card("old", "card_review", "2026-09-21T00:00:01.000Z"),
    card("edge", "card_review", "2026-09-21T00:00:05.000Z"),
    card("new", "card_review", "2026-09-21T00:00:09.000Z"),
  ];
  assert.deepEqual(
    pendingReports(messages, parseReportAck("2026-09-21T00:00:05.000Z"), present).map(
      (r) => r.messageId,
    ),
    ["new"],
  );
});

test("맵에 없는 NPC 의 보고는 큐에 넣지 않는다 — 걸어올 주체가 없다", () => {
  const messages = [
    card("gone", "card_review", "2026-09-21T00:00:01.000Z", "npc-absent"),
    card("here", "card_review", "2026-09-21T00:00:02.000Z", "npc-2"),
  ];
  assert.deepEqual(
    pendingReports(messages, EMPTY_REPORT_ACK, present).map((r) => r.messageId),
    ["here"],
  );
});

test("발신자 id 가 없는 알림(시스템 대체)은 큐에 넣지 않는다", () => {
  const orphan = card("sys", "card_review", "2026-09-21T00:00:01.000Z");
  assert.deepEqual(
    pendingReports(
      [{ ...orphan, senderKind: "system", senderId: null }],
      EMPTY_REPORT_ACK,
      present,
    ),
    [],
  );
});

test("보고 항목은 카드로 이동할 값을 함께 싣는다", () => {
  const [item] = pendingReports(
    [card("a", "card_review", "2026-09-21T00:00:01.000Z")],
    EMPTY_REPORT_ACK,
    present,
  );
  assert.deepEqual(item, {
    messageId: "a",
    jobId: null,
    npcId: "npc-1",
    npcName: "소피",
    kind: "card_review",
    cardId: "c-a",
    boardSlug: "b",
    cardTitle: "제목 a",
    summary: "카드",
    createdAt: "2026-09-21T00:00:01.000Z",
  });
});

test("크론 실패 보고는 열어야 할 곳이 카드가 아니라 크론 이력이다", () => {
  const [item] = pendingReports(
    [
      msg({
        id: "cron",
        createdAt: "2026-09-21T00:00:01.000Z",
        notice: {
          kind: "cron_result",
          jobId: "job-7",
          jobName: "야간 집계",
          npcName: "소피",
          status: "error",
        },
      }),
    ],
    EMPTY_REPORT_ACK,
    present,
  );
  assert.equal(item.kind, "cron_failed");
  assert.equal(item.cardId, null, "열 카드가 없다");
  assert.equal(item.jobId, "job-7", "대신 크론 이력으로 갈 값을 싣는다");
  assert.equal(item.cardTitle, "야간 집계");
});

test("카드 보고에는 jobId 가 없다", () => {
  const [item] = pendingReports(
    [card("a", "card_review", "2026-09-21T00:00:01.000Z")],
    EMPTY_REPORT_ACK,
    present,
  );
  assert.equal(item.jobId, null);
});

test("옛 문자열 워터마크는 그 시각 이전을 확인된 것으로 읽는다 — 하위 호환", () => {
  assert.deepEqual(parseReportAck("2026-09-21T00:00:05.000Z"), {
    through: "2026-09-21T00:00:05.000Z",
    ids: [],
  });
  assert.deepEqual(parseReportAck(null), EMPTY_REPORT_ACK);
  assert.deepEqual(parseReportAck("{깨짐"), EMPTY_REPORT_ACK);
});

test("확인은 건 단위로 쌓이고 저장·복원된다", () => {
  const ack = acknowledgeReport(
    acknowledgeReport(parseReportAck("2026-09-21T00:00:05.000Z"), "b"),
    "b",
  );
  assert.deepEqual(ack.ids, ["b"], "같은 건을 두 번 넣지 않는다");
  assert.deepEqual(parseReportAck(serializeReportAck(ack)), ack);
});
