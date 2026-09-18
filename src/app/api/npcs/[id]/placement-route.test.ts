import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { authHeaders, seedChannelWithProfiles, setupThrowawaySqlite } from "@/test-setup/npc-seed";
import { buildOfficeEnvironment } from "@/game/three/office-environments";
import { seatingMapFor } from "@/lib/seat-assignment";

/**
 * 배치 라우트의 계약. 자리는 채널 안에서 유일해야 하고
 * (`npcs_channel_position_unique`), 그 충돌은 **409** 로 나가야 한다 —
 * 클라이언트는 409 를 보고 배치 모드를 유지한 채 다음 칸을 기다린다. 500 이면
 * "배치 실패" 토스트가 뜨고 배치 모드가 끝나 버린다.
 */
setupThrowawaySqlite("npc-placement-route-test");

async function put(npcId: string, userId: string, body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  return PUT(
    new NextRequest(`http://localhost/api/npcs/${npcId}`, {
      method: "PUT",
      headers: authHeaders(userId),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: npcId }) },
  );
}

test("이미 누가 선 칸으로 옮기면 409 tile_already_occupied 다", async () => {
  // 배치된 둘은 (0,0) 과 (1,0) 에 선다.
  const { npcIds, userId } = await seedChannelWithProfiles({ placedActive: 2 });

  const res = await put(npcIds[1], userId, { positionX: 0, positionY: 0 });

  assert.equal(res.status, 409);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "tile_already_occupied");
});

test("빈 칸으로는 옮겨진다", async () => {
  const { npcIds, userId } = await seedChannelWithProfiles({ placedActive: 2 });

  const res = await put(npcIds[1], userId, { positionX: 5, positionY: 7 });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { npc: { positionX: number; positionY: number } };
  assert.equal(body.npc.positionX, 5);
  assert.equal(body.npc.positionY, 7);
});

test("자리 미정 NPC 에 자리를 준다 — 만들지 않고 자리만 채운다", async () => {
  const { npcIds, userId } = await seedChannelWithProfiles({ placedActive: 1, unplaced: 1 });

  const res = await put(npcIds[1], userId, { positionX: 3, positionY: 4 });

  assert.equal(res.status, 200);
  const body = (await res.json()) as { npc: { id: string; positionX: number } };
  assert.equal(body.npc.id, npcIds[1], "새 행을 만들지 않는다");
  assert.equal(body.npc.positionX, 3);
});

test("데스크 좌석이 아닌 칸은 400 not_a_desk_seat", async () => {
  const mapData = buildOfficeEnvironment("executive");
  const { npcIds, userId } = await seedChannelWithProfiles({ unplaced: 1, mapData });
  const { standing, seats } = seatingMapFor({ mapData })!;

  const bad = await put(npcIds[0], userId, {
    positionX: standing[0].col,
    positionY: standing[0].row,
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).errorCode, "not_a_desk_seat");

  const ok = await put(npcIds[0], userId, { positionX: seats[1].col, positionY: seats[1].row });
  assert.equal(ok.status, 200);

  const directionOnly = await put(npcIds[0], userId, { direction: "left" });
  assert.equal(directionOnly.status, 200, "방향만 바꾸는 요청은 검사하지 않는다");
});
