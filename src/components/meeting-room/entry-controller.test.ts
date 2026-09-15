import assert from "node:assert/strict";
import test from "node:test";
import { MeetingEntryController } from "./entry-controller";

test("도착 전에는 UI를 열지 않으며 반복 요청과 늦은 도착을 무시한다", () => {
  const effects: string[] = [];
  const entry = new MeetingEntryController((event) => effects.push(event));
  entry.request();
  entry.request();
  assert.deepEqual(effects, ["request"]);
  assert.equal(entry.state.status, "walking");
  entry.cancel();
  entry.arrival({ status: "arrived" });
  assert.equal(entry.state.status, "idle");
  entry.request();
  entry.arrival({ status: "arrived" });
  assert.equal(entry.state.status, "joining");
  entry.joined();
  assert.equal(entry.state.status, "joined");
  entry.cancel();
  assert.equal(entry.state.status, "idle");
});

test("동기 도착과 거절 뒤 재시도를 지원한다", () => {
  const entry = new MeetingEntryController((event) => {
    if (event === "request") entry.arrival({ status: "arrived" });
  });
  entry.request();
  assert.equal(entry.state.status, "joining");
  entry.fail("forbidden");
  assert.equal(entry.state.reasonCode, "forbidden");
  entry.joined();
  assert.equal(entry.state.status, "failed");
  entry.request();
  assert.equal(entry.state.status, "joining");
});
