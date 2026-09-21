import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { authHeaders, seedChannel, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";
import { DEFAULT_NPC_MOTION } from "@/lib/npc-motion-config";
import { buildOfficeEnvironment } from "@/game/three/office-environments";

// GET 은 회의실 맵을 정규화하므로 유효한 맵이 있어야 200 이다.
const office = () => buildOfficeEnvironment("agency");

// 채널의 NPC 걸음 속도 — 채널 공유 설정이라 DB 에 두고, 소유자만 바꾸며, 바꾸면 방송한다.
setupThrowawaySqlite("channel-motion-config-test");

/** 채널 저장 뒤 소켓 서버로 가는 내부 방송을 가로챈다(실제 소켓 서버가 없다). */
function captureEmits() {
  const original = globalThis.fetch;
  const emits: { event: string; payload: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    if (init?.body) emits.push(JSON.parse(init.body));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { emits, restore: () => (globalThis.fetch = original) };
}

async function route() {
  return import("./[id]/route");
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("걸음 설정이 비어 있는 채널은 기본값을 돌려준다 — 클라이언트가 빈 값을 해석하지 않는다", async () => {
  const owner = await seedUser("motion-owner-1");
  const channel = await seedChannel(owner.id, "걸음 채널", office());
  const { GET } = await route();
  const res = await GET(
    new NextRequest(`http://localhost/api/channels/${channel.id}`, {
      headers: authHeaders(owner.id),
    }),
    params(channel.id),
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).channel.motionConfig, DEFAULT_NPC_MOTION);
});

test("소유자가 바꾸면 접어서 저장하고, 방송에 motionConfig 를 싣는다", async () => {
  const owner = await seedUser("motion-owner-2");
  const channel = await seedChannel(owner.id, "걸음 채널 2", office());
  const { GET, PUT } = await route();
  const cap = captureEmits();
  try {
    const res = await PUT(
      new NextRequest(`http://localhost/api/channels/${channel.id}`, {
        method: "PUT",
        headers: authHeaders(owner.id),
        body: JSON.stringify({ motionConfig: { summon: 402, walk: 9999, bogus: 1 } }),
      }),
      params(channel.id),
    );
    assert.equal(res.status, 200);
    const emitted = cap.emits.find((e) => e.event === "channel:updated");
    assert.ok(emitted, "channel:updated 를 방송하지 않았습니다");
    assert.deepEqual(emitted.payload.motionConfig, {
      ...DEFAULT_NPC_MOTION,
      summon: 400,
      walk: 480,
    });
  } finally {
    cap.restore();
  }
  const read = await GET(
    new NextRequest(`http://localhost/api/channels/${channel.id}`, {
      headers: authHeaders(owner.id),
    }),
    params(channel.id),
  );
  const saved = (await read.json()).channel.motionConfig;
  assert.equal(saved.summon, 400, "5 단위로 맞춰 저장한다");
  assert.equal(saved.walk, 480, "범위 위는 잘라서 저장한다");
  assert.equal("bogus" in saved, false);
});

test("걸음 설정을 안 바꾼 저장은 방송에 motionConfig 를 싣지 않는다 — 구버전 계약 그대로", async () => {
  const owner = await seedUser("motion-owner-3");
  const channel = await seedChannel(owner.id, "걸음 채널 3", office());
  const { PUT } = await route();
  const cap = captureEmits();
  try {
    await PUT(
      new NextRequest(`http://localhost/api/channels/${channel.id}`, {
        method: "PUT",
        headers: authHeaders(owner.id),
        body: JSON.stringify({ description: "설명만" }),
      }),
      params(channel.id),
    );
    const emitted = cap.emits.find((e) => e.event === "channel:updated");
    assert.ok(emitted);
    assert.deepEqual(Object.keys(emitted.payload).sort(), ["isPublic", "name"]);
  } finally {
    cap.restore();
  }
});

test("소유자가 아니면 걸음 설정을 바꿀 수 없다", async () => {
  const owner = await seedUser("motion-owner-4");
  const other = await seedUser("motion-other-4");
  const channel = await seedChannel(owner.id, "걸음 채널 4", office());
  const { GET, PUT } = await route();
  const cap = captureEmits();
  try {
    const res = await PUT(
      new NextRequest(`http://localhost/api/channels/${channel.id}`, {
        method: "PUT",
        headers: authHeaders(other.id),
        body: JSON.stringify({ motionConfig: { summon: 60 } }),
      }),
      params(channel.id),
    );
    assert.equal(res.status, 403);
  } finally {
    cap.restore();
  }
  const read = await GET(
    new NextRequest(`http://localhost/api/channels/${channel.id}`, {
      headers: authHeaders(owner.id),
    }),
    params(channel.id),
  );
  assert.equal((await read.json()).channel.motionConfig.summon, DEFAULT_NPC_MOTION.summon);
});
