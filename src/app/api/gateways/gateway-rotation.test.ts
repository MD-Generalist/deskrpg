import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  setupThrowawaySqlite,
  seedUser,
  seedGateway,
  seedChannel,
  authHeaders,
} from "@/test-setup/npc-seed";
setupThrowawaySqlite("gateway-rotation");

test("token rotation preserves the bound gateway; invalid keys and non-owners cannot change it", async () => {
  const server = http.createServer((req, res) => {
    const valid = req.headers.authorization === "Bearer replacement-key";
    res.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        valid
          ? { plugin: "deskrpg", version: "0.12.1", capabilities: ["kanban", "cron", "events"] }
          : { error: "unauthorized" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    const { db, gatewayResources, channelGatewayBindings } = await import("@/db");
    const { decryptGatewayToken } = await import("@/lib/gateway-resources");
    const { setGatewayRuntimeState, getCachedGatewayRuntimeState } =
      await import("@/lib/gateway-runtime-cache");
    const { PATCH } = await import("./[id]/route");
    const user = await seedUser();
    const other = await seedUser();
    const gateway = await seedGateway(user.id, `http://127.0.0.1:${address.port}`);
    const channel = await seedChannel(user.id);
    await db
      .insert(channelGatewayBindings)
      .values({ channelId: channel.id, gatewayId: gateway.id, boundByUserId: user.id });
    const patch = (token: string, userId = user.id, url = gateway.baseUrl) =>
      PATCH(
        new NextRequest("http://localhost/api/gateways/" + gateway.id, {
          method: "PATCH",
          headers: authHeaders(userId),
          body: JSON.stringify({ token, url }),
        }),
        { params: Promise.resolve({ id: gateway.id }) },
      );
    const read = async () =>
      (await db.select().from(gatewayResources).where(eq(gatewayResources.id, gateway.id)))[0];
    assert.equal((await patch("replacement-key", other.id)).status, 403);
    assert.equal((await patch("wrong-key")).status, 400);
    assert.equal((await read()).tokenEncrypted, gateway.tokenEncrypted);
    assert.equal((await patch("replacement-key", user.id, "http://different.test")).status, 409);
    setGatewayRuntimeState(gateway.id, { status: "forbidden" });
    const response = await patch("replacement-key");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.gateway.id, gateway.id);
    assert.equal(JSON.stringify(body).includes("replacement-key"), false);
    assert.equal(decryptGatewayToken((await read()).tokenEncrypted), "replacement-key");
    assert.equal(getCachedGatewayRuntimeState(gateway.id), null);
    assert.equal((await read()).pluginCheckedAt, null);
    assert.equal(
      (
        await db
          .select()
          .from(channelGatewayBindings)
          .where(eq(channelGatewayBindings.channelId, channel.id))
      )[0].gatewayId,
      gateway.id,
    );
    assert.equal((await patch("")).status, 200);
    assert.equal(decryptGatewayToken((await read()).tokenEncrypted), "replacement-key");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
