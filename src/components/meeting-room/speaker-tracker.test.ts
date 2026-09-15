import assert from "node:assert/strict";
import test from "node:test";
import { MeetingSpeakerTracker } from "./speaker-tracker";

test("생각 시작은 발언이 아니고 스트림 조각마다 발언 ID를 바꾸지 않는다", () => {
  const changes: unknown[] = [];
  const tracker = new MeetingSpeakerTracker((speaker) => changes.push(speaker));
  tracker.turn("a");
  assert.deepEqual(changes, [null]);
  tracker.stream("a", "");
  tracker.stream("a", "hello");
  tracker.stream("a", "hello world");
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[1], { kind: "npc", id: "a", utteranceId: "npc:a:1" });
  tracker.finish("a");
  tracker.stream("a", "second");
  assert.deepEqual(changes.at(-1), { kind: "npc", id: "a", utteranceId: "npc:a:2" });
});

test("사용자는 서버 userId로만 매핑하며 이름이나 socketId를 actorId로 대체하지 않는다", () => {
  const changes: unknown[] = [];
  const tracker = new MeetingSpeakerTracker((speaker) => changes.push(speaker));
  tracker.user("socket-a", "m1", [{ id: "socket-a", userId: "user-a" }]);
  assert.deepEqual(changes.at(-1), { kind: "user", id: "user-a", utteranceId: "m1" });
  tracker.user("missing", "m2", []);
  assert.equal(changes.at(-1), null);
});
