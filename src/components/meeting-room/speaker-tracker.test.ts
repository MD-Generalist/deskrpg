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

test("사용자 발언은 4초 뒤 전체 시점으로 복귀하며 이전 타이머는 새 발언을 지우지 않는다", () => {
  const changes: unknown[] = [];
  const timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const tracker = new MeetingSpeakerTracker(
    (speaker) => changes.push(speaker),
    (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  );
  const roster = [{ id: "socket-a", userId: "user-a" }];
  tracker.user("socket-a", "first", roster);
  assert.equal(timers[0]?.delay, 4000);
  timers[0].callback();
  assert.equal(changes.at(-1), null);

  tracker.user("socket-a", "second", roster);
  tracker.user("socket-a", "third", roster);
  assert.equal(timers[1].cancelled, true);
  timers[1].callback();
  assert.deepEqual(changes.at(-1), { kind: "user", id: "user-a", utteranceId: "third" });
  tracker.turn("npc-a");
  tracker.stream("npc-a", "hello");
  const npcSpeech = changes.at(-1);
  timers[2].callback();
  assert.equal(changes.at(-1), npcSpeech);

  tracker.user("socket-a", "fourth", roster);
  tracker.finish("npc-a");
  assert.deepEqual(changes.at(-1), { kind: "user", id: "user-a", utteranceId: "fourth" });
  tracker.dispose();
  assert.equal(timers[3].cancelled, true);
  const count = changes.length;
  timers[3].callback();
  assert.equal(changes.length, count);
});

test("사용자는 서버 userId로만 매핑하며 이름이나 socketId를 actorId로 대체하지 않는다", () => {
  const changes: unknown[] = [];
  const tracker = new MeetingSpeakerTracker((speaker) => changes.push(speaker));
  tracker.user("socket-a", "m1", [{ id: "socket-a", userId: "user-a" }]);
  assert.deepEqual(changes.at(-1), { kind: "user", id: "user-a", utteranceId: "m1" });
  tracker.user("missing", "m2", []);
  assert.equal(changes.at(-1), null);
});
