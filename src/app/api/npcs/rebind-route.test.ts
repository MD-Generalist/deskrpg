import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import {
  seedChannel,
  seedGateway,
  seedHermesProfile,
  seedNpc,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// Regression test for the rebind IDOR: a caller who owns the NPC's channel must not be
// able to bind that NPC to a Hermes profile on a gateway they have no relationship to.
// DB-backed (drizzle over @/db), so — same as src/lib/hermes-profiles.test.ts — this runs
// against a real temporary SQLite database rather than mocking `db`. `db` is a lazily
// initialized module singleton and node:test runs each test *file* in its own process, so
// setting SQLITE_PATH once at module scope (before any test body touches `db`) pins every
// test in this file to one throwaway DB.
//
// 씨앗은 src/test-setup/npc-seed.ts 를 쓴다 — `npcs.hermes_profile_id` 가 NOT NULL 이
// 된 뒤로 "프로필 없는 NPC" 는 스키마가 거부한다. 그래서 이 테스트는 "미바인딩 → 바인딩"
// 이 아니라 **프로필 A 에 묶인 NPC 를 프로필 B 로 옮기는가**를 본다.
setupThrowawaySqlite("rebind-route-test");

async function loadDb() {
  return import("@/db");
}

/** 자기 게이트웨이의 프로필에 이미 묶여 있는 NPC 를 가진 채널. */
async function seedChannelWithBoundNpc(ownerId: string) {
  const ownGateway = await seedGateway(ownerId);
  const ownProfile = await seedHermesProfile(ownGateway.id, { profileName: "own" });
  const channel = await seedChannel(ownerId);
  const npc = await seedNpc({
    channelId: channel.id,
    hermesProfileId: ownProfile.id,
    positionX: 0,
    positionY: 0,
    // 어댑터 타입을 명시한다 — 이 테스트가 보는 것은 "403 일 때 값이 바뀌지 않는가"이지
    // 컬럼 기본값이 무엇인가가 아니다. 기본값에 기대면 기본값이 바뀔 때 같이 깨진다.
    adapterType: "unbound",
  });
  return { channel, npc, ownProfile };
}

describe("POST /api/npcs/[id]/rebind", () => {
  test("refuses to bind an NPC to a profile on a gateway the caller cannot access, and leaves the NPC row unmodified", async () => {
    const { POST } = await import("./[id]/rebind/route");

    const victimOwner = await seedUser("victim-owner");
    const victimGateway = await seedGateway(victimOwner.id);
    const victimProfile = await seedHermesProfile(victimGateway.id, { profileName: "sophie" });

    const attacker = await seedUser("attacker");
    const { npc, ownProfile } = await seedChannelWithBoundNpc(attacker.id);

    const req = new NextRequest("http://localhost/api/npcs/x/rebind", {
      method: "POST",
      headers: { "x-user-id": attacker.id, "content-type": "application/json" },
      body: JSON.stringify({ profileId: victimProfile.id }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: npc.id }) });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.errorCode, "forbidden");

    const { db, npcs } = await loadDb();
    const [reloaded] = await db.select().from(npcs).where(eq(npcs.id, npc.id));
    assert.equal(
      reloaded.hermesProfileId,
      ownProfile.id,
      "the NPC must still be bound to its original profile",
    );
    assert.equal(reloaded.adapterType, "unbound", "the NPC's adapter type must be left unchanged");
  });

  test("allows binding when the caller has share access (not just ownership) to the profile's gateway", async () => {
    const { POST } = await import("./[id]/rebind/route");

    const gatewayOwner = await seedUser("gateway-owner");
    const gateway = await seedGateway(gatewayOwner.id);
    const profile = await seedHermesProfile(gateway.id, { profileName: "sophie" });

    const { db, gatewayShares } = await loadDb();
    const npcOwner = await seedUser("npc-owner");
    await db
      .insert(gatewayShares)
      .values({ gatewayId: gateway.id, userId: npcOwner.id, role: "use" });
    const { npc, ownProfile } = await seedChannelWithBoundNpc(npcOwner.id);
    assert.notEqual(ownProfile.id, profile.id);

    const req = new NextRequest("http://localhost/api/npcs/x/rebind", {
      method: "POST",
      headers: { "x-user-id": npcOwner.id, "content-type": "application/json" },
      body: JSON.stringify({ profileId: profile.id }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: npc.id }) });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.npc.hermesProfileId, profile.id);
    assert.equal(body.npc.adapterType, "hermes");
  });
});
