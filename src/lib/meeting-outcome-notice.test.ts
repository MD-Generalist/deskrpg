// 회의 결과 방 알림 — 언제 내는가(순수 판정)와, 방에 남고 등록 뒤 되쓰이는가(일회용 SQLite).
import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingOutcome } from "@/lib/meeting-outcome";
import { seedChannel, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

import { buildMeetingOutcomeNotice, shouldAnnounceOutcome } from "./meeting-outcome-notice";

setupThrowawaySqlite("meeting-outcome-notice-test");

const followUp = {
  title: "경쟁사 가격 조사",
  summary: null,
  acceptance: null,
  assigneeNpcId: null,
  assigneeName: null,
  after: [],
};

const outcome: MeetingOutcome = {
  decisions: ["A안 채택"],
  followUps: [followUp, { ...followUp, title: "초안 작성" }],
  project: { recommended: true, name: "가격 개편", reason: null },
};

test("후속 업무가 있고 요약이 성공했을 때만 알린다", () => {
  assert.equal(shouldAnnounceOutcome(outcome, "ok"), true);
  // 짧은 확인 회의가 다수다 — 제안할 것이 없는데 줄을 남기면 방이 소음으로 찬다.
  assert.equal(shouldAnnounceOutcome({ ...outcome, followUps: [] }, "ok"), false);
  assert.equal(shouldAnnounceOutcome(null, "ok"), false);
  // 요약 실패는 "제안할 것이 없음" 과 다르다. 실패는 회의 화면이 다시 시도를 권한다 — 방에는 남기지 않는다.
  assert.equal(shouldAnnounceOutcome(outcome, "failed"), false);
  assert.equal(shouldAnnounceOutcome(outcome, "skipped"), false);
});

test("알림은 id 와 개수만 싣는다 — 프로젝트 이름 같은 낡는 사본을 두지 않는다", () => {
  assert.deepEqual(buildMeetingOutcomeNotice({ minutesId: "m-1", topic: "가격 개편", outcome }), {
    kind: "meeting_outcome",
    minutesId: "m-1",
    topic: "가격 개편",
    followUpCount: 2,
    recommended: true,
  });
});

async function officeNotices(channelId: string) {
  const { ensureOfficeRoom, recentRoomMessages, getChannelOwnerId } =
    await import("@/lib/chat-rooms");
  const ownerId = await getChannelOwnerId(channelId);
  assert.ok(ownerId);
  const room = await ensureOfficeRoom(channelId, ownerId!);
  const messages = await recentRoomMessages(room.id, 20);
  return messages.filter((m) => m.notice?.kind === "meeting_outcome");
}

async function seed() {
  const owner = await seedUser(`mon-${Math.random().toString(36).slice(2, 8)}`);
  const channel = await seedChannel(owner.id, "회의 알림 채널");
  return { ownerId: owner.id, channelId: channel.id };
}

test("알리면 사무실 방에 시스템 알림이 남고 방송 훅이 불린다", async () => {
  const { channelId } = await seed();
  const { registerAutomationHooks, resetAutomationHooksForTests } =
    await import("@/lib/automation-registry");
  const emitted: unknown[] = [];
  registerAutomationHooks({
    pollNow: async () => null,
    refreshPollers: async () => {},
    getWorkingSnapshot: () => [],
    emitRoomMessage: (_roomId: string, message: unknown) => {
      emitted.push(message);
    },
  });
  try {
    const { announceMeetingOutcome } = await import("./meeting-outcome-notice");
    await announceMeetingOutcome({
      channelId,
      minutesId: "m-2",
      topic: "가격 개편",
      outcome,
      summaryStatus: "ok",
    });
  } finally {
    resetAutomationHooksForTests();
  }

  const rows = await officeNotices(channelId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].senderKind, "system");
  assert.equal(rows[0].content, "가격 개편", "로케일 무관 폴백은 회의 주제다");
  assert.equal(emitted.length, 1, "저장만 하고 방송하지 않으면 새로고침 전까지 보이지 않는다");
});

test("알릴 조건이 아니면 방에 아무것도 남기지 않는다", async () => {
  const { channelId } = await seed();
  const { announceMeetingOutcome } = await import("./meeting-outcome-notice");
  await announceMeetingOutcome({
    channelId,
    minutesId: "m-3",
    topic: "확인",
    outcome: { ...outcome, followUps: [] },
    summaryStatus: "ok",
  });
  assert.equal((await officeNotices(channelId)).length, 0);
});

test("등록되면 같은 줄에 결과가 되쓰인다 — 다른 회의의 알림은 건드리지 않는다", async () => {
  const { channelId } = await seed();
  const { announceMeetingOutcome, markMeetingOutcomeNoticeRegistered } =
    await import("./meeting-outcome-notice");
  for (const minutesId of ["m-4", "m-40"])
    await announceMeetingOutcome({
      channelId,
      minutesId,
      topic: minutesId,
      outcome,
      summaryStatus: "ok",
    });

  const { registerAutomationHooks, resetAutomationHooksForTests } =
    await import("@/lib/automation-registry");
  const reEmitted: Array<{ id?: string; notice?: { minutesId?: string; resolved?: unknown } }> = [];
  registerAutomationHooks({
    pollNow: async () => null,
    refreshPollers: async () => {},
    getWorkingSnapshot: () => [],
    emitRoomMessage: (_roomId: string, message: unknown) => {
      reEmitted.push(message as (typeof reEmitted)[number]);
    },
  });
  try {
    await markMeetingOutcomeNoticeRegistered({
      channelId,
      minutesId: "m-4",
      registered: {
        boardSlug: "board-1",
        tenant: "가격-개편",
        taskIds: ["t1", "t2"],
        by: "user-1",
        at: "2026-09-21T00:00:00.000Z",
      },
    });
  } finally {
    resetAutomationHooksForTests();
  }
  // 되쓴 줄을 같은 id 로 다시 방송한다 — 그러지 않으면 열려 있는 화면은 새로고침 전까지 등록 버튼을 그대로 보여 준다.
  assert.equal(reEmitted.length, 1);
  assert.equal(reEmitted[0].notice?.minutesId, "m-4");
  assert.ok(reEmitted[0].notice?.resolved);

  const byId = new Map(
    (await officeNotices(channelId)).map((m) => {
      assert.ok(m.notice?.kind === "meeting_outcome");
      return [m.notice.kind === "meeting_outcome" ? m.notice.minutesId : "", m.notice] as const;
    }),
  );
  const done = byId.get("m-4");
  assert.ok(done?.kind === "meeting_outcome");
  assert.deepEqual(done.kind === "meeting_outcome" ? done.resolved : null, {
    boardSlug: "board-1",
    tenant: "가격-개편",
    taskCount: 2,
    by: "user-1",
    at: "2026-09-21T00:00:00.000Z",
  });
  // `m-4` 는 `m-40` 의 부분 문자열이다 — LIKE 로 찾은 뒤 id 를 정확히 맞춰야 한다.
  const other = byId.get("m-40");
  assert.equal(other?.kind === "meeting_outcome" ? other.resolved : "x", undefined);
});

test("알림 줄이 없어도 되쓰기는 던지지 않는다 — 등록을 실패시키지 않는다", async () => {
  const { channelId } = await seed();
  const { markMeetingOutcomeNoticeRegistered } = await import("./meeting-outcome-notice");
  await markMeetingOutcomeNoticeRegistered({
    channelId,
    minutesId: "없는-회의",
    registered: { boardSlug: "b", tenant: null, taskIds: [], by: "u", at: "2026-09-21T00:00:00Z" },
  });
});
