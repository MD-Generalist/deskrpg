import assert from "node:assert/strict";
import test from "node:test";

import { consumeNpcStreamBuffer } from "./stream-state";

test("consumeNpcStreamBuffer returns a finalized message and removes the stream", () => {
  const result = consumeNpcStreamBuffer({
    streams: { "npc-1": "hello world" },
    npcId: "npc-1",
    fallbackSenderName: "으뉴",
    timestamp: 123,
  });

  assert.deepEqual(result.nextStreams, {});
  assert.deepEqual(result.finalizedMessage, {
    id: "msg-123-npc-1",
    sender: "으뉴",
    senderId: "npc-npc-1",
    senderType: "npc",
    content: "hello world",
    timestamp: 123,
  });
});

test("consumeNpcStreamBuffer returns no message when the buffer is empty", () => {
  const result = consumeNpcStreamBuffer({
    streams: {},
    npcId: "npc-1",
    fallbackSenderName: "으뉴",
    timestamp: 123,
  });

  assert.deepEqual(result.nextStreams, {});
  assert.equal(result.finalizedMessage, null);
});

test("서버가 최종 본문을 주면 스트림 누적분 대신 그것으로 말풍선을 확정한다", () => {
  // 델타에는 재시도된 앞선 생성까지 쌓일 수 있다 — 회의 기록(서버의 최종 본문)과 화면이 같아야 한다.
  const result = consumeNpcStreamBuffer({
    streams: { oliver: "첫 생성. 둘째 생성." },
    npcId: "oliver",
    fallbackSenderName: "올리버",
    timestamp: 1,
    finalText: "둘째 생성.",
  });
  assert.equal(result.finalizedMessage?.content, "둘째 생성.");
  assert.deepEqual(result.nextStreams, {});
});

test("청크 없이 최종 본문만 와도 말풍선이 생긴다", () => {
  const result = consumeNpcStreamBuffer({
    streams: {},
    npcId: "oliver",
    fallbackSenderName: "올리버",
    timestamp: 1,
    finalText: "한 덩어리 응답",
  });
  assert.equal(result.finalizedMessage?.content, "한 덩어리 응답");
});

test("최종 본문이 비었거나 문자열이 아니면 예전처럼 누적분을 쓴다", () => {
  for (const finalText of ["", undefined, { x: 1 } as unknown as string]) {
    const result = consumeNpcStreamBuffer({
      streams: { oliver: "누적분" },
      npcId: "oliver",
      fallbackSenderName: "올리버",
      timestamp: 1,
      finalText,
    });
    assert.equal(result.finalizedMessage?.content, "누적분");
  }
});
