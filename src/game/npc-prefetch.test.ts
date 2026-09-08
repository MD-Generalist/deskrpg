import test from "node:test";
import assert from "node:assert/strict";

import { fetchChannelNpcs } from "./npc-prefetch";

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return {
      ok: res.ok,
      status: res.status,
      json: async () => res.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("채널이 있으면 channelId 를 실어 부르고 목록을 준다", async () => {
  const { impl, calls } = stubFetch({
    ok: true,
    status: 200,
    body: { npcs: [{ id: "n1", name: "올리버", positionX: 3, positionY: 4, direction: "down" }] },
  });

  const result = await fetchChannelNpcs("ch-1", impl);

  assert.deepEqual(calls, ["/api/npcs?channelId=ch-1"]);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.npcs.length, 1);
});

test("채널이 비면 아예 부르지 않는다 — 채널 없는 /api/npcs 는 400 이다", async () => {
  const { impl, calls } = stubFetch({ ok: true, status: 200, body: { npcs: [] } });

  const result = await fetchChannelNpcs("", impl);

  assert.deepEqual(calls, [], "채널 없이 /api/npcs 를 부르면 안 된다");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-channel");
});

test("4xx 를 빈 목록으로 삼키지 않는다 — 상태를 담아 실패로 돌려준다", async () => {
  // 이것이 회귀의 핵심이다. 예전 코드는 `data.npcs || []` 라서 400 응답이
  // "NPC 0명" 으로 그려졌고, 사용자에게는 아무 오류도 보이지 않았다.
  const { impl } = stubFetch({
    ok: false,
    status: 400,
    body: { errorCode: "channel_id_required" },
  });

  const result = await fetchChannelNpcs("ch-1", impl);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "http-error");
  assert.match(!result.ok ? result.message : "", /400/);
});

test("fetch 자체가 터져도 실패로 보고한다", async () => {
  const impl = (async () => {
    throw new Error("boom");
  }) as unknown as typeof fetch;

  const result = await fetchChannelNpcs("ch-1", impl);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "network-error");
  assert.equal(!result.ok && result.message, "boom");
});
