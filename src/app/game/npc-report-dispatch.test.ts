import assert from "node:assert/strict";
import test from "node:test";

import type { ReportItem } from "@/game/report-queue";

import { acknowledgedThrough, decideReportCall, reportAckKey } from "./npc-report-dispatch";

const item = (messageId: string, npcId: string, createdAt: string): ReportItem => ({
  messageId,
  npcId,
  npcName: "소피",
  kind: "card_review",
  cardId: `c-${messageId}`,
  boardSlug: "b",
  cardTitle: messageId,
  createdAt,
});

const A = item("a", "npc-1", "2026-09-21T00:00:01.000Z");
const B = item("b", "npc-2", "2026-09-21T00:00:02.000Z");

test("큐가 비어 있으면 아무도 부르지 않는다", () => {
  assert.equal(
    decideReportCall({ queue: [], activeNpcId: null, calledMessageIds: [], blocked: false }),
    null,
  );
});

test("맨 앞 보고의 NPC 를 부른다", () => {
  assert.equal(
    decideReportCall({ queue: [A, B], activeNpcId: null, calledMessageIds: [], blocked: false })
      ?.messageId,
    "a",
  );
});

test("대화창·모달이 열려 있으면 부르지 않는다 — 큐는 남는다", () => {
  assert.equal(
    decideReportCall({ queue: [A, B], activeNpcId: null, calledMessageIds: [], blocked: true }),
    null,
  );
});

test("이미 호출을 쏜 보고는 다시 부르지 않는다 — 걸어오는 중에 재호출하지 않는다", () => {
  assert.equal(
    decideReportCall({
      queue: [A, B],
      activeNpcId: "npc-1",
      calledMessageIds: ["a"],
      blocked: false,
    }),
    null,
  );
});

test("보고 중인 NPC 의 보고가 끝나 큐에서 빠지면 다음 사람을 부른다", () => {
  assert.equal(
    decideReportCall({ queue: [B], activeNpcId: "npc-1", calledMessageIds: ["a"], blocked: false })
      ?.messageId,
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
