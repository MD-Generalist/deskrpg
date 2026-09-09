import assert from "node:assert/strict";
import test from "node:test";
import {
  decideResponders,
  resolveRoomAccessDecision,
  sortRooms,
  type RoomSummary,
} from "./chat-rooms-policy";

test("mention 정책: 지명된 NPC 만, 지명 없으면 아무도", () => {
  assert.deepEqual(decideResponders("mention", ["a"], ["a", "b"]), ["a"]);
  assert.deepEqual(decideResponders("mention", [], ["a", "b"]), []);
});
test("members 정책: 지명 없으면 멤버 전원, 있으면 지명된 멤버만", () => {
  assert.deepEqual(decideResponders("members", [], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(decideResponders("members", ["b"], ["a", "b"]), ["b"]);
  assert.deepEqual(decideResponders("members", ["z"], ["a", "b"]), [], "멤버가 아닌 지명은 무시");
});
test("목록: office 가 맨 위, 나머지는 최신 메시지순", () => {
  const r = (id: string, kind: "office" | "group", last: string | null): RoomSummary => ({
    id,
    kind,
    name: id,
    replyPolicy: "members",
    createdBy: "u",
    lastMessageAt: last,
    members: [],
  });
  const sorted = sortRooms([
    r("g1", "group", "2026-09-01"),
    r("off", "office", null),
    r("g2", "group", "2026-09-09"),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ["off", "g2", "g1"],
  );
});
test("접근: 없으면 not_found, 채널 권한 없으면 forbidden, office 는 멤버 아니어도 ok, group 은 멤버여야", () => {
  const office = {
    id: "o",
    channelId: "c",
    kind: "office",
    name: "office",
    replyPolicy: "mention",
    createdBy: "u",
    createdAt: new Date(),
    lastMessageAt: null,
  } as const;
  const group = { ...office, id: "g", kind: "group" } as const;
  assert.deepEqual(
    resolveRoomAccessDecision({ room: null, channelAllowed: true, isMember: true }),
    { ok: false, code: "not_found" },
  );
  assert.deepEqual(
    resolveRoomAccessDecision({ room: office, channelAllowed: false, isMember: false }),
    { ok: false, code: "forbidden" },
  );
  assert.equal(
    resolveRoomAccessDecision({ room: office, channelAllowed: true, isMember: false }).ok,
    true,
  );
  assert.deepEqual(
    resolveRoomAccessDecision({ room: group, channelAllowed: true, isMember: false }),
    { ok: false, code: "forbidden" },
  );
  assert.equal(
    resolveRoomAccessDecision({ room: group, channelAllowed: true, isMember: true }).ok,
    true,
  );
});
