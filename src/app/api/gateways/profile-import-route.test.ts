import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  authHeaders,
  seedChannel,
  seedGateway,
  seedUser,
  setupThrowawaySqlite,
} from "@/test-setup/npc-seed";

// Importing a Hermes profile that already exists (made on the host, or before DeskRPG connected):
// the plugin mints its key on the owner key, DeskRPG stores it encrypted right away, and the
// employee clocks into the offices the gateway is bound to. The key never leaves the server.
setupThrowawaySqlite("profile-import-route-test");

type KeyReply = { status: number; body: unknown };

/** A plugin stand-in: lists profiles and answers the key route with `keyReply`. */
async function startPlugin(opts: {
  profiles: string[];
  keyReply: (rotate: boolean, name: string) => KeyReply;
  listReply?: KeyReply;
}) {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  // Key requests being answered at once — each answer is held briefly so overlap would show.
  const keyLoad = { inFlight: 0, peak: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization ?? "",
        body,
      });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.method === "GET" && req.url === "/deskrpg/profiles") {
        if (opts.listReply) {
          const { status, body: reply } = opts.listReply;
          if (typeof reply === "string") {
            res.writeHead(status, { "content-type": "text/plain" });
            return res.end(reply);
          }
          return send(status, reply);
        }
        return send(200, {
          profiles: opts.profiles.map((name) => ({
            name,
            description: `${name} desc`,
            hasCustomPersona: true,
          })),
        });
      }
      const match = req.url?.match(/^\/deskrpg\/profiles\/([^/]+)\/key$/);
      if (req.method === "POST" && match) {
        const rotate = body ? JSON.parse(body).rotate === true : false;
        const reply = opts.keyReply(rotate, decodeURIComponent(match[1]));
        keyLoad.inFlight += 1;
        keyLoad.peak = Math.max(keyLoad.peak, keyLoad.inFlight);
        setTimeout(() => {
          keyLoad.inFlight -= 1;
          send(reply.status, reply.body);
        }, 10);
        return;
      }
      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  server.unref();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    seen,
    keyLoad,
    close: () => server.close(),
  };
}

const ISSUED = "k".repeat(43);
const issue = (rotated = false, name = "vps-sam"): KeyReply => ({
  status: 201,
  body: { name, apiKey: ISSUED, issued: true, rotated },
});

async function fixture(
  keyReply: (rotate: boolean, name: string) => KeyReply,
  profiles = ["default", "vps-sam", "sophie"],
  listReply?: KeyReply,
) {
  const plugin = await startPlugin({ profiles, keyReply, listReply });
  const owner = await seedUser("owner");
  const gateway = await seedGateway(owner.id, plugin.baseUrl);
  const { registerHermesProfile, bindGatewayToChannel } = {
    ...(await import("@/lib/hermes-profiles")),
    ...(await import("@/lib/gateway-resources")),
  };
  await registerHermesProfile({
    userId: owner.id,
    gatewayId: gateway.id,
    profileName: "sophie",
    token: "sophie-key-1234567890",
  });
  const channel = await seedChannel(owner.id);
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: owner.id,
  });
  // Binding may probe the gateway; only count what the import itself asks the plugin.
  plugin.seen.length = 0;
  return { plugin, owner, gateway, channel };
}

async function importProfile(gatewayId: string, name: string, userId: string, body?: unknown) {
  const { POST } = await import("./[id]/plugin/profiles/[name]/import/route");
  return POST(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/plugin/profiles/${name}/import`, {
      method: "POST",
      headers: authHeaders(userId),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: gatewayId, name }) },
  );
}

async function importable(gatewayId: string, userId: string) {
  const { GET } = await import("./[id]/plugin/profiles/importable/route");
  return GET(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/plugin/profiles/importable`, {
      headers: authHeaders(userId),
    }),
    { params: Promise.resolve({ id: gatewayId }) },
  );
}

test("the importable list is the gateway's profiles minus default and the ones already registered", async () => {
  const f = await fixture(() => issue());
  const res = await importable(f.gateway.id, f.owner.id);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).profiles, [{ name: "vps-sam", description: "vps-sam desc" }]);
  assert.ok(f.plugin.seen.every((c) => c.auth === "Bearer gateway-owner-key-1234567890"));
});

test("a failed list rides on 200 with a code the screen can explain", async () => {
  for (const [reply, code] of [
    // Hermes' answer when the registered key is not the listener owner's key (api_server.py).
    [
      {
        status: 401,
        body: {
          error: {
            message: "Invalid gateway API key (API_SERVER_KEY)",
            type: "gateway_auth_error",
            code: "gateway_auth_failed",
          },
        },
      },
      "gateway_auth_failed",
    ],
    // An older plugin has no such route: aiohttp answers a bare 404 text.
    [{ status: 404, body: "404: Not Found" }, "plugin_update_required"],
  ] as const) {
    const f = await fixture(() => issue(), undefined, reply as KeyReply);
    const res = await importable(f.gateway.id, f.owner.id);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).errorCode, code, code);
  }
});

async function importAll(gatewayId: string, userId: string, body: unknown) {
  const { POST } = await import("./[id]/plugin/profiles/importable/route");
  return POST(
    new NextRequest(`http://localhost/api/gateways/${gatewayId}/plugin/profiles/importable`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: gatewayId }) },
  );
}

async function registered(gatewayId: string) {
  const { db, hermesProfiles } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ name: hermesProfiles.profileName })
    .from(hermesProfiles)
    .where(eq(hermesProfiles.gatewayId, gatewayId));
  return rows.map((r) => r.name).sort();
}

const MANY = ["default", "sophie", "ann", "bo", "cy", "dee"];

test("importing all takes every chosen profile, one key request at a time", async () => {
  const f = await fixture((_rotate, name) => issue(false, name), MANY);
  const res = await importAll(f.gateway.id, f.owner.id, { names: ["ann", "bo", "cy"] });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(ISSUED), "no key in the response");
  assert.deepEqual(
    JSON.parse(text).results.map((r: { name: string; status: string }) => [r.name, r.status]),
    [
      ["ann", "imported"],
      ["bo", "imported"],
      ["cy", "imported"],
    ],
  );
  assert.deepEqual(await registered(f.gateway.id), ["ann", "bo", "cy", "sophie"]);
  assert.equal(f.plugin.keyLoad.peak, 1);
  assert.deepEqual(
    f.plugin.seen.filter((c) => c.url.endsWith("/key")).map((c) => JSON.parse(c.body)),
    [{}, {}, {}],
    "never rotates",
  );
});

test("a profile that already has a key is skipped and left for its own choice", async () => {
  const f = await fixture(
    (_rotate, name) =>
      name === "bo" ? { status: 409, body: { error: "key_exists", name } } : issue(false, name),
    MANY,
  );
  const body = await (
    await importAll(f.gateway.id, f.owner.id, { names: ["ann", "bo", "cy"] })
  ).json();
  assert.deepEqual(
    body.results.map((r: { status: string }) => r.status),
    ["imported", "key_exists", "imported"],
  );
  assert.deepEqual(await registered(f.gateway.id), ["ann", "cy", "sophie"]);
});

test("a failure keeps what was imported, and a gateway-wide failure stops the rest", async () => {
  const f = await fixture(
    (_rotate, name) =>
      name === "bo"
        ? { status: 409, body: { error: "external_secret_provider", name } }
        : name === "cy"
          ? {
              status: 401,
              body: { error: { code: "gateway_auth_failed", message: "Invalid gateway API key" } },
            }
          : issue(false, name),
    MANY,
  );
  const body = await (
    await importAll(f.gateway.id, f.owner.id, { names: ["ann", "bo", "cy", "dee"] })
  ).json();
  assert.deepEqual(body.results, [
    { name: "ann", status: "imported", attendedChannels: 1 },
    { name: "bo", status: "failed", errorCode: "external_secret_provider" },
    { name: "cy", status: "failed", errorCode: "gateway_auth_failed" },
    { name: "dee", status: "not_tried" },
  ]);
  assert.deepEqual(await registered(f.gateway.id), ["ann", "sophie"]);
  assert.ok(!f.plugin.seen.some((c) => c.url === "/deskrpg/profiles/dee/key"));
});

test("only the chosen names are imported, and a bad list is refused", async () => {
  const f = await fixture((_rotate, name) => issue(false, name), MANY);
  const body = await (await importAll(f.gateway.id, f.owner.id, { names: ["bo"] })).json();
  assert.deepEqual(body.results, [{ name: "bo", status: "imported", attendedChannels: 1 }]);
  assert.deepEqual(await registered(f.gateway.id), ["bo", "sophie"]);
  for (const bad of [{}, { names: [] }, { names: ["bo", "bo"] }, { names: [1] }, []]) {
    assert.equal((await importAll(f.gateway.id, f.owner.id, bad)).status, 400, JSON.stringify(bad));
  }
});

test("only the gateway owner imports all: shared user 403, no access 404, plugin not called", async () => {
  const f = await fixture((_rotate, name) => issue(false, name), MANY);
  const { createGatewayShare } = await import("@/lib/gateway-resources");
  const shared = await seedUser("shared-all");
  await createGatewayShare({
    ownerUserId: f.owner.id,
    gatewayId: f.gateway.id,
    targetLoginId: shared.loginId,
  });
  const stranger = await seedUser("stranger-all");
  assert.equal((await importAll(f.gateway.id, shared.id, { names: ["ann"] })).status, 403);
  assert.equal((await importAll(f.gateway.id, stranger.id, { names: ["ann"] })).status, 404);
  assert.equal(f.plugin.seen.length, 0);
  assert.deepEqual(await registered(f.gateway.id), ["sophie"]);
});

test("importing stores the key encrypted, clocks the employee in, and never returns the key", async () => {
  const f = await fixture(() => issue());
  const res = await importProfile(f.gateway.id, "vps-sam", f.owner.id);
  assert.equal(res.status, 201);
  const text = await res.text();
  assert.ok(!text.includes(ISSUED), "the key must not be in the response");
  const body = JSON.parse(text);
  assert.equal(body.profile.profileName, "vps-sam");
  assert.equal(body.profile.tokenEncrypted, undefined);
  assert.equal(body.attendedChannels, 1);
  assert.equal(body.rotated, false);

  const { db, hermesProfiles, npcs } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { decryptGatewayToken } = await import("@/lib/gateway-resources");
  const [row] = await db
    .select()
    .from(hermesProfiles)
    .where(
      and(eq(hermesProfiles.gatewayId, f.gateway.id), eq(hermesProfiles.profileName, "vps-sam")),
    );
  assert.equal(decryptGatewayToken(row.tokenEncrypted), ISSUED);
  assert.equal(row.provisionedByDeskrpg, false);
  const hired = await db.select().from(npcs).where(eq(npcs.hermesProfileId, row.id));
  assert.deepEqual(
    hired.map((n) => n.channelId),
    [f.channel.id],
  );

  const keyCall = f.plugin.seen.find((c) => c.url === "/deskrpg/profiles/vps-sam/key");
  assert.equal(keyCall?.auth, "Bearer gateway-owner-key-1234567890");
  assert.deepEqual(JSON.parse(keyCall!.body), {});
});

test("a profile that already has a key answers key_exists, and rotate replaces it", async () => {
  const f = await fixture((rotate) =>
    rotate ? issue(true) : { status: 409, body: { error: "key_exists", name: "vps-sam" } },
  );
  const refused = await importProfile(f.gateway.id, "vps-sam", f.owner.id);
  assert.equal((await refused.json()).errorCode, "key_exists");
  const { db, hermesProfiles } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const byName = and(
    eq(hermesProfiles.gatewayId, f.gateway.id),
    eq(hermesProfiles.profileName, "vps-sam"),
  );
  assert.equal(
    (await db.select().from(hermesProfiles).where(byName)).length,
    0,
    "nothing is registered on a refusal",
  );

  const rotated = await importProfile(f.gateway.id, "vps-sam", f.owner.id, { rotate: true });
  assert.equal(rotated.status, 201);
  assert.equal((await rotated.json()).rotated, true);
});

test("plugin refusals pass through as their own codes", async () => {
  for (const [reply, code] of [
    [
      { status: 409, body: { error: "external_secret_provider", name: "vps-sam" } },
      "external_secret_provider",
    ],
    [{ status: 404, body: { error: "no_profile", name: "vps-sam" } }, "no_profile"],
    // An older plugin has no such route: aiohttp answers a bare 404 text.
    [{ status: 404, body: "404: Not Found" }, "plugin_update_required"],
  ] as const) {
    const f = await fixture(() => reply as KeyReply);
    const res = await importProfile(f.gateway.id, "vps-sam", f.owner.id);
    assert.equal((await res.json()).errorCode, code, code);
  }
});

test("only the gateway owner imports: shared user 403, no access 404, and the plugin is not called", async () => {
  const f = await fixture(() => issue());
  const { createGatewayShare } = await import("@/lib/gateway-resources");
  const shared = await seedUser("shared");
  await createGatewayShare({
    ownerUserId: f.owner.id,
    gatewayId: f.gateway.id,
    targetLoginId: shared.loginId,
  });
  const stranger = await seedUser("stranger");

  assert.equal((await importProfile(f.gateway.id, "vps-sam", shared.id)).status, 403);
  assert.equal((await importProfile(f.gateway.id, "vps-sam", stranger.id)).status, 404);
  assert.equal((await importable(f.gateway.id, shared.id)).status, 403);
  assert.equal((await importable(f.gateway.id, stranger.id)).status, 404);
  assert.equal(f.plugin.seen.length, 0);
});

test("default and an already registered profile are refused before the plugin is asked", async () => {
  const f = await fixture(() => issue());
  assert.equal(
    (await (await importProfile(f.gateway.id, "default", f.owner.id)).json()).errorCode,
    "default_profile",
  );
  assert.equal(
    (await (await importProfile(f.gateway.id, "sophie", f.owner.id)).json()).errorCode,
    "already_registered",
  );
  assert.equal(f.plugin.seen.length, 0);
});

test("rotate must be true when sent", async () => {
  const f = await fixture(() => issue());
  const res = await importProfile(f.gateway.id, "vps-sam", f.owner.id, { rotate: "yes" });
  assert.equal(res.status, 400);
  assert.equal(f.plugin.seen.length, 0);
});
