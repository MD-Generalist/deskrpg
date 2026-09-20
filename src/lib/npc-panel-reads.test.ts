import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { seedChannel, seedUser, setupThrowawaySqlite, authHeaders } from "@/test-setup/npc-seed";
import {
  PanelSourceError,
  readBadges,
  markTabSeen,
  type BadgeDeps,
  type PanelReadRow,
  type PanelTab,
} from "@/lib/npc-panel-reads";

// T-badges. 직원 대화창의 `카드`·`크론` 탭 배지.
//
// 계산은 순수 함수(`npc-panel-reads-count.ts`)가 하고 여기서 고정하는 것은 조합이다:
// 어떤 조회가 실패했을 때 어느 배지가 살아남는가, 탭에 따라 무엇을 쓰는가. 라우트 케이스는
// 관문(비멤버 403)과 본문 검증(모르는 tab 400)만 본다 — 게이트웨이 없는 채널에서도 200 이
// 나와야 하므로 플러그인 세팅은 필요 없다.
setupThrowawaySqlite("npc-panel-reads-test");

const target = { channelId: "c1", userId: "u1", npcId: "n1" };

function gateError(status: number, code: string): PanelSourceError {
  return new PanelSourceError(status, code);
}

type Written = { seenAt?: Date; seenIds?: string[] };

function stubDeps(opts: {
  assignedIds?: string[];
  seenIds?: string[];
  cronTimes?: string[];
  cronSeenAt?: string | null;
  boardError?: PanelSourceError;
  cronError?: PanelSourceError;
}): BadgeDeps & { written: Written } {
  const written: Written = {};
  return {
    written,
    async loadAssignedCardIds() {
      if (opts.boardError) throw opts.boardError;
      return opts.assignedIds ?? [];
    },
    async loadCronNoticeTimes() {
      if (opts.cronError) throw opts.cronError;
      return opts.cronTimes ?? [];
    },
    async loadPanelRead(_t, tab: PanelTab): Promise<PanelReadRow | null> {
      if (tab === "cards") return { seenAt: null, seenIds: opts.seenIds ?? [] };
      return { seenAt: opts.cronSeenAt ?? null, seenIds: [] };
    },
    async savePanelRead(_t, _tab, patch) {
      written.seenAt = patch.seenAt;
      written.seenIds = patch.seenIds;
    },
    now: () => new Date("2026-09-21T12:00:00.000Z"),
  };
}

test("배지는 담당 카드 중 안 본 것과 seenAt 이후 크론을 센다", async () => {
  const deps = stubDeps({
    assignedIds: ["a", "b", "c"],
    seenIds: ["a"],
    cronTimes: ["2026-09-20T00:00:00Z", "2026-09-22T00:00:00Z"],
    cronSeenAt: "2026-09-21T00:00:00Z",
  });
  assert.deepEqual(await readBadges(target, deps), { cards: 2, cron: 1 });
});

test("열람 기록이 없으면 전부 미확인이다", async () => {
  const deps = stubDeps({
    assignedIds: ["a"],
    seenIds: [],
    cronTimes: ["2026-09-20T00:00:00Z"],
    cronSeenAt: null,
  });
  assert.deepEqual(await readBadges(target, deps), { cards: 1, cron: 1 });
});

test("cards 탭 열람은 현재 담당 카드를 모두 본 것으로 만들고 옛 id 를 가지친다", async () => {
  const deps = stubDeps({ assignedIds: ["a", "b"], seenIds: ["옛것"] });
  await markTabSeen({ ...target, tab: "cards" }, deps);
  assert.deepEqual(deps.written.seenIds!.sort(), ["a", "b"]);
});

test("cron 탭 열람은 seen_at 만 올리고 seen_ids 를 쓰지 않는다", async () => {
  const deps = stubDeps({});
  await markTabSeen({ ...target, tab: "cron" }, deps);
  assert.equal(deps.written.seenIds, undefined);
  assert.ok(deps.written.seenAt);
});

test("보드를 못 가져오면 카드 배지는 0 이고 크론 배지는 그대로 센다", async () => {
  const deps = stubDeps({
    boardError: gateError(428, "plugin_required"),
    cronTimes: ["2026-09-20T00:00:00Z"],
    cronSeenAt: null,
  });
  assert.deepEqual(await readBadges(target, deps), { cards: 0, cron: 1 });
});

test("보드를 못 가져오면 cards 탭 열람은 이전 기록을 유지한다", async () => {
  const deps = stubDeps({ boardError: gateError(503, "board_unavailable"), seenIds: ["a"] });
  await markTabSeen({ ...target, tab: "cards" }, deps);
  assert.deepEqual(deps.written.seenIds, ["a"]);
});

// --- 라우트 -----------------------------------------------------------------

type Routes = typeof import("@/app/api/channels/[id]/npcs/[npcId]/panel-reads/route");

async function loadRoute(): Promise<Routes> {
  return import("@/app/api/channels/[id]/npcs/[npcId]/panel-reads/route");
}

function req(channelId: string, userId: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/channels/${channelId}/npcs/n1/panel-reads`, {
    method,
    headers: authHeaders(userId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = (id: string, npcId = "n1") => ({ params: Promise.resolve({ id, npcId }) });

test("비멤버는 403", async () => {
  const { GET } = await loadRoute();
  const owner = await seedUser("panel-owner");
  const outsider = await seedUser("panel-outsider");
  const channel = await seedChannel(owner.id);
  const res = await GET(req(channel.id, outsider.id, "GET"), ctx(channel.id));
  assert.equal(res.status, 403);
});

test("로그인하지 않으면 401", async () => {
  const { GET } = await loadRoute();
  const owner = await seedUser("panel-owner");
  const channel = await seedChannel(owner.id);
  const res = await GET(
    new NextRequest(`http://localhost/api/channels/${channel.id}/npcs/n1/panel-reads`),
    ctx(channel.id),
  );
  assert.equal(res.status, 401);
});

test("모르는 tab 값은 400", async () => {
  const { POST } = await loadRoute();
  const owner = await seedUser("panel-owner");
  const channel = await seedChannel(owner.id);
  const res = await POST(req(channel.id, owner.id, "POST", { tab: "무엇" }), ctx(channel.id));
  assert.equal(res.status, 400);
});
