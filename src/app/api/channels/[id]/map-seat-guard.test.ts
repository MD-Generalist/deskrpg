import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { authHeaders, seedChannelWithProfiles, setupThrowawaySqlite } from "@/test-setup/npc-seed";
import { buildOfficeEnvironment } from "@/game/three/office-environments";
import { commonAreaSeats } from "@/game/three/seating";
import { projectMeetingMap } from "@/game/meeting-map-normalization";
import { seatingMapFor } from "@/lib/seat-assignment";
import type { TiledMap } from "@/lib/tiled-map";

/**
 * 채널 맵을 저장할 때 데스크 좌석이 하나도 없으면 400 을 낸다 — 그대로 저장되면
 * 자리 배정이 조용히 전원을 서 있는 채로 남기고, 지정자리 배정 UI 는 빈 명부만 본다.
 *
 * "의자를 전부 뺀다" 는 회의실 탁자 옆 공용 의자까지 지워 맵 자체를 무효로 만든다
 * (`normalizeMeetingMap` 이 회의 테이블 주변에 앉을 자리를 요구한다). 개인 데스크
 * 좌석(공용 테이블에 붙지 않은 `chair`)만 걸러낸다 — `deskSeats`/`commonAreaSeats`
 * (`src/game/three/seating.ts`) 가 가르는 것과 같은 경계다.
 */
setupThrowawaySqlite("channel-map-seat-guard-test");

function stripDeskChairs(map: TiledMap): TiledMap {
  // `projectMeetingMap` 은 Tiled 오브젝트를 픽셀→타일(col/row) 좌표로 투영한다. 원본
  // Tiled 오브젝트는 `x`/`y` 픽셀만 갖고 있어, 공용 좌석과 같은 타일인지는 그 투영된
  // 좌표로만 비교할 수 있다.
  const projected = projectMeetingMap(map);
  const keep = new Set(
    commonAreaSeats(projected.objects).map(
      (seat) => `${Math.floor(seat.anchorX ?? seat.x)},${Math.floor(seat.anchorZ ?? seat.z)}`,
    ),
  );
  return {
    ...map,
    layers: map.layers.map((layer) =>
      layer.type === "objectgroup"
        ? {
            ...layer,
            objects: (layer.objects ?? []).filter(
              (object) => object.type !== "chair" || keep.has(`${object.x / 32},${object.y / 32}`),
            ),
          }
        : layer,
    ),
  };
}

test("의자를 뺀 픽스처는 좌석이 0개다 — 이 단언이 깨지면 아래 테스트는 의미가 없다", () => {
  const stripped = stripDeskChairs(buildOfficeEnvironment("executive"));
  assert.equal(seatingMapFor({ mapData: stripped })!.seats.length, 0);
});

test("데스크 의자가 하나도 없는 맵은 400 map_has_no_desk_seats", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    mapData: buildOfficeEnvironment("executive"),
  });
  const { PUT } = await import("./route");
  const stripped = stripDeskChairs(buildOfficeEnvironment("executive"));

  const res = await PUT(
    new NextRequest(`http://localhost/api/channels/${channelId}`, {
      method: "PUT",
      headers: { ...authHeaders(userId), "content-type": "application/json" },
      body: JSON.stringify({ mapData: stripped }),
    }),
    { params: Promise.resolve({ id: channelId }) },
  );

  assert.equal(res.status, 400);
  assert.equal((await res.json()).errorCode, "map_has_no_desk_seats");
});

test("원본 맵(의자 포함)은 그대로 저장된다", async () => {
  const { channelId, userId } = await seedChannelWithProfiles({
    mapData: buildOfficeEnvironment("executive"),
  });
  const { PUT } = await import("./route");

  const res = await PUT(
    new NextRequest(`http://localhost/api/channels/${channelId}`, {
      method: "PUT",
      headers: { ...authHeaders(userId), "content-type": "application/json" },
      body: JSON.stringify({ mapData: buildOfficeEnvironment("executive") }),
    }),
    { params: Promise.resolve({ id: channelId }) },
  );

  assert.equal(res.status, 200);
});
