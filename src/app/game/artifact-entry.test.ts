import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_ARTIFACTS_MODAL,
  nextArtifactChips,
  nextKanbanFocus,
  planSourceNavigation,
  reduceArtifactsModal,
  type ArtifactSocketEvent,
} from "./artifact-entry";

test("결과물 모달 — 열린 동안의 사건만 tick·마지막 사건에 쌓는다", () => {
  let s = reduceArtifactsModal(INITIAL_ARTIFACTS_MODAL, {
    type: "event",
    kind: "artifact.deleted",
    artifactId: "a1",
  });
  assert.equal(s.refreshTick, 0, "닫힌 동안에는 모달 tick 이 오르지 않는다");
  assert.equal(s.lastEvent, null);
  assert.equal(s.eventSeq, 1, "칸반 섹션용 신호는 계속 오른다");

  s = reduceArtifactsModal(s, { type: "open", initial: { taskId: "t1" } });
  assert.equal(s.show, true);
  assert.deepEqual(s.initial, { taskId: "t1" });
  s = reduceArtifactsModal(s, { type: "event", kind: "artifact.versioned", artifactId: "a2" });
  assert.equal(s.refreshTick, 1);
  assert.deepEqual(s.lastEvent, { kind: "artifact.versioned", artifactId: "a2" });
});

test("결과물 모달 — 닫으면 tick·마지막 사건·초기값을 비워 다시 열린 모달이 옛 사건을 되풀이하지 않는다", () => {
  let s = reduceArtifactsModal(INITIAL_ARTIFACTS_MODAL, {
    type: "open",
    initial: { artifactId: "a1" },
  });
  s = reduceArtifactsModal(s, { type: "event", kind: "artifact.deleted", artifactId: "a1" });
  s = reduceArtifactsModal(s, { type: "close" });
  assert.equal(s.show, false);
  assert.equal(s.refreshTick, 0);
  assert.equal(s.lastEvent, null);
  assert.equal(s.initial, null);
  s = reduceArtifactsModal(s, { type: "open" });
  assert.equal(s.refreshTick, 0);
  assert.equal(s.lastEvent, null);
  assert.equal(s.initial, null);
});

const ev = (
  kind: string,
  payload: NonNullable<ArtifactSocketEvent["event"]>["payload"],
): ArtifactSocketEvent => ({ channelId: "ch", event: { kind, payload } });

test("채팅 칩 — 열린 NPC 프로필의 채팅 출처 created/versioned 만 더한다", () => {
  const chat = { artifact_id: "a1", title: "대시보드", profile: "sophie", source_kind: "chat" };
  assert.deepEqual(nextArtifactChips([], ev("artifact.created", chat), "sophie"), [
    { artifactId: "a1", title: "대시보드" },
  ]);
  assert.deepEqual(nextArtifactChips([], ev("artifact.versioned", chat), "sophie"), [
    { artifactId: "a1", title: "대시보드" },
  ]);
  assert.deepEqual(nextArtifactChips([], ev("artifact.deleted", chat), "sophie"), []);
  assert.deepEqual(
    nextArtifactChips([], ev("artifact.created", { ...chat, source_kind: "kanban" }), "sophie"),
    [],
  );
  assert.deepEqual(nextArtifactChips([], ev("artifact.created", chat), "other"), []);
  assert.deepEqual(nextArtifactChips([], ev("artifact.created", chat), null), []);
});

test("채팅 칩 — 같은 결과물은 한 번만, 새 버전의 제목은 갱신한다", () => {
  const chat = { artifact_id: "a1", title: "대시보드", profile: "sophie", source_kind: "chat" };
  const first = nextArtifactChips([], ev("artifact.created", chat), "sophie");
  const same = nextArtifactChips(first, ev("artifact.versioned", chat), "sophie");
  assert.equal(same, first, "바뀐 게 없으면 같은 배열");
  const renamed = nextArtifactChips(
    first,
    ev("artifact.versioned", { ...chat, title: "대시보드 v2" }),
    "sophie",
  );
  assert.deepEqual(renamed, [{ artifactId: "a1", title: "대시보드 v2" }]);
});

test("출처로 이동 — 채팅은 칸반·크론을 닫고 그 NPC 대화를 연다", () => {
  const npcs = [{ id: "n1", name: "소피", profileName: "sophie" }];
  assert.deepEqual(planSourceNavigation({ type: "chat", profile: "sophie" }, npcs), {
    closeKanban: true,
    closeCron: true,
    open: { type: "chat", npcId: "n1", npcName: "소피" },
  });
  assert.equal(
    planSourceNavigation({ type: "chat", profile: "gone" }, npcs),
    null,
    "그 프로필의 NPC 가 없으면 아무것도 하지 않는다(결과물 모달 유지)",
  );
});

test("출처로 이동 — 크론은 칸반을 닫고, 칸반은 크론을 닫는다(두 모달이 겹치지 않게)", () => {
  assert.deepEqual(planSourceNavigation({ type: "cron", jobId: "j1", profile: "sophie" }, []), {
    closeKanban: true,
    closeCron: false,
    open: { type: "cron", jobId: "j1" },
  });
  assert.deepEqual(planSourceNavigation({ type: "cron", jobId: null, profile: "sophie" }, []), {
    closeKanban: true,
    closeCron: false,
    open: { type: "cron", jobId: null },
  });
  assert.deepEqual(planSourceNavigation({ type: "kanban", taskId: "t9" }, []), {
    closeKanban: false,
    closeCron: true,
    open: { type: "kanban", taskId: "t9" },
  });
});

test("칸반 포커스 요청 — 같은 카드를 다시 요청해도 seq 가 올라 새 요청이 된다", () => {
  const a = nextKanbanFocus(null, "t1");
  assert.deepEqual(a, { taskId: "t1", seq: 1 });
  const b = nextKanbanFocus(a, "t1");
  assert.deepEqual(b, { taskId: "t1", seq: 2 });
  assert.notEqual(a, b);
});
