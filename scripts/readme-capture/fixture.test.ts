import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOfficeEnvironment } from "../../src/game/three/office-environments";
import { CAPTURE_ACCOUNT, prepareFixture, type FixtureApi } from "./fixture";

function recordingFixtureApi(
  calls: string[],
  options: { mapTemplateId?: string } = {},
): FixtureApi {
  const mapTemplateId = options.mapTemplateId ?? "template-trading";
  return {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH",
      requestPath: string,
      body?: unknown,
    ) {
      if (method === "POST" && requestPath === "/api/auth/register") {
        calls.push("register");
        assert.deepEqual(body, CAPTURE_ACCOUNT);
        return { user: { id: "user-1", nickname: "Dante" } } as T;
      }
      if (method === "POST" && requestPath === "/api/characters") {
        calls.push("character");
        assert.equal((body as { name?: string }).name, "Dante");
        assert.ok((body as { appearance?: unknown }).appearance);
        return { character: { id: "character-1", name: "Dante" } } as T;
      }
      if (method === "POST" && requestPath === "/api/gateways") {
        calls.push("gateway");
        assert.deepEqual(body, {
          url: "http://127.0.0.1:38642",
          token: "readme-capture-gateway-token",
          displayName: "README Capture",
        });
        return { gateway: { id: "gateway-1" } } as T;
      }
      if (method === "POST" && requestPath === "/api/gateways/gateway-1/profiles") {
        const profileName = (body as { profileName: string }).profileName;
        calls.push(`profile:${profileName}`);
        const displayName = profileName === "sophie" ? "Sophie" : "Noah";
        assert.deepEqual(body, {
          profileName,
          token: `readme-capture-${profileName}-token`,
          displayName,
        });
        return { profile: { id: `profile-${profileName}`, profileName, displayName } } as T;
      }
      if (method === "GET" && requestPath === "/api/groups") {
        calls.push("group");
        return { groups: [{ id: "group-1", name: "Default", isDefault: true }] } as T;
      }
      if (
        method === "PATCH" &&
        requestPath.startsWith("/api/gateways/gateway-1/profiles/profile-")
      ) {
        assert.ok((body as { appearance?: unknown }).appearance);
        return { ok: true } as T;
      }
      if (method === "PUT" && requestPath.startsWith("/api/npcs/npc-")) {
        const sophie = requestPath.endsWith("sophie");
        assert.deepEqual(body, {
          positionX: sophie ? 13 : 15,
          positionY: sophie ? 17 : 18,
          direction: "down",
        });
        return { npc: { id: sophie ? "npc-sophie" : "npc-noah" } } as T;
      }
      if (method === "GET" && requestPath === "/api/map-templates") {
        calls.push("template");
        return {
          templates: [
            { id: "template-other", name: "Small Office", tags: null },
            {
              id: mapTemplateId,
              name: "종합상사",
              tags: "deskrpg-office-v2:trading",
              cols: 30,
              rows: 22,
            },
          ],
        } as T;
      }
      if (method === "GET" && requestPath === `/api/map-templates/${mapTemplateId}`) {
        return {
          template: {
            id: mapTemplateId,
            name: "종합상사",
            tags: "deskrpg-office-v2:trading",
            cols: 30,
            rows: 22,
            spawnCol: 15,
            spawnRow: 19,
            tiledJson: buildOfficeEnvironment("trading"),
          },
        } as T;
      }
      if (method === "POST" && requestPath === "/api/channels") {
        calls.push("channel");
        assert.deepEqual(body, {
          name: "Dante Labs Office",
          description: "Hermes agents at work",
          isPublic: true,
          mapTemplateId,
          groupId: "group-1",
          gatewayConfig: { gatewayId: "gateway-1" },
        });
        return { channel: { id: "channel-1" } } as T;
      }
      if (method === "GET" && requestPath === "/api/npcs?channelId=channel-1&roster=1") {
        calls.push("roster");
        return {
          npcs: [
            { id: "npc-sophie", name: "Sophie", positionX: 6, positionY: 5 },
            { id: "npc-noah", name: "Noah", positionX: 10, positionY: 5 },
          ],
        } as T;
      }
      if (method === "GET" && requestPath === "/api/channels/channel-1/kanban/board") {
        calls.push("board");
        return { columns: [] } as T;
      }
      if (method === "POST" && requestPath === "/api/channels/channel-1/kanban/tasks") {
        calls.push("report");
        assert.deepEqual(body, {
          title: "시네마틱 캡처 준비",
          body: "장면과 미디어 규격 점검을 완료했습니다.",
          assignee: "npc-sophie",
        });
        return { task: { id: "capture-card-1", status: "todo" } } as T;
      }
      throw new Error(`Unexpected fixture request: ${method} ${requestPath}`);
    },
  };
}

function withRuntime(): { root: string; sqlitePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-fixture-"));
  const sqlitePath = path.join(root, ".artifacts/readme-capture/runtime/data/db.sqlite");
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  return { root, sqlitePath };
}

test("places newly hired unplaced NPCs and sets deterministic profile appearances through the API", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const delegate = recordingFixtureApi([]);
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  const api: FixtureApi = {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH",
      requestPath: string,
      body?: unknown,
    ): Promise<T> {
      if (method === "PUT" || method === "PATCH") writes.push({ method, path: requestPath, body });
      if (requestPath.includes("&roster=1"))
        return {
          npcs: [
            { id: "npc-sophie", name: "Sophie", positionX: null, positionY: null },
            { id: "npc-noah", name: "Noah", positionX: null, positionY: null },
          ],
        } as T;
      return delegate.request<T>(method, requestPath, body);
    },
  };
  await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);
  assert.deepEqual(
    writes.filter((w) => w.method === "PUT").map((w) => w.body),
    [
      { positionX: 13, positionY: 17, direction: "down" },
      { positionX: 15, positionY: 18, direction: "down" },
    ],
  );
  const appearances = writes.filter((w) => w.method === "PATCH");
  assert.equal(appearances.length, 2);
  assert.notDeepEqual(appearances[0].body, appearances[1].body);
});

test("creates a user, character, channel, gateway, profiles and NPCs in dependency order", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls: string[] = [];

  const fixture = await prepareFixture(
    recordingFixtureApi(calls),
    "http://127.0.0.1:38642",
    sqlitePath,
  );

  assert.deepEqual(calls, [
    "register",
    "character",
    "gateway",
    "profile:sophie",
    "profile:noah",
    "group",
    "template",
    "channel",
    "roster",
    "board",
    "report",
  ]);
  assert.equal(fixture.channelId, "channel-1");
  assert.deepEqual(fixture.npcNames, ["Sophie", "Noah"]);

  assert.equal(
    fs.existsSync(sqlitePath),
    false,
    "fixture must not create a local card/report database",
  );
});

test("a second fixture run reuses an existing Hermes card without duplicating it", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = recordingFixtureApi([]);
  let created = false;
  let creations = 0;
  const api: FixtureApi = {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH",
      requestPath: string,
      body?: unknown,
    ): Promise<T> {
      if (requestPath.endsWith("/kanban/board") && created)
        return {
          columns: [
            {
              name: "todo",
              tasks: [{ id: "capture-card-1", title: "시네마틱 캡처 준비", assignee: "sophie" }],
            },
          ],
        } as T;
      if (requestPath.endsWith("/kanban/tasks") && method === "POST") {
        created = true;
        creations += 1;
      }
      return base.request<T>(method, requestPath, body);
    },
  };
  const first = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);
  const second = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);

  assert.equal(second.channelId, first.channelId);
  assert.equal(creations, 1);
  assert.equal(
    fs.existsSync(sqlitePath),
    false,
    "fixture must not create a local card/report database",
  );
});

test("an interrupted run reuses the fixed account character and channel", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls: string[] = [];
  const base = recordingFixtureApi(calls);
  const api: FixtureApi = {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH",
      requestPath: string,
      body?: unknown,
    ): Promise<T> {
      if (method === "POST" && requestPath === "/api/auth/register") {
        calls.push("register");
        return { user: { id: "user-1", nickname: "Dante" }, existing: true } as T;
      }
      if (method === "GET" && requestPath === "/api/characters") {
        calls.push("character:list");
        return { characters: [{ id: "character-1", name: "Dante" }] } as T;
      }
      if (method === "GET" && requestPath === "/api/channels") {
        calls.push("channel:list");
        return {
          channels: [{ id: "channel-1", name: "Dante Labs Office", ownerId: "user-1" }],
        } as T;
      }
      return base.request<T>(method, requestPath, body);
    },
  };

  const fixture = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);

  assert.equal(fixture.channelId, "channel-1");
  assert.equal(calls.includes("character"), false);
  assert.equal(calls.includes("channel"), false);
  assert.deepEqual(calls, [
    "register",
    "character:list",
    "gateway",
    "profile:sophie",
    "profile:noah",
    "group",
    "template",
    "channel:list",
    "roster",
    "board",
    "report",
  ]);
});

test("a fresh runtime creates the tagged trading-company template through the API", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls: string[] = [];
  const base = recordingFixtureApi(calls, { mapTemplateId: "template-created" });
  const api: FixtureApi = {
    async request<T>(
      method: "GET" | "POST" | "PUT",
      requestPath: string,
      body?: unknown,
    ): Promise<T> {
      if (method === "GET" && requestPath === "/api/map-templates") {
        calls.push("template");
        return { templates: [{ id: "template-other", name: "Small Office", tags: null }] } as T;
      }
      if (method === "POST" && requestPath === "/api/map-templates") {
        calls.push("template:create");
        const template = body as {
          tags?: string;
          cols?: number;
          rows?: number;
          tiledJson?: {
            layers?: Array<{
              name?: string;
              properties?: Array<{ name?: string; value?: string }>;
            }>;
          };
        };
        assert.equal(template.tags, "deskrpg-office-v2:trading");
        assert.equal(template.cols, 30);
        assert.equal(template.rows, 22);
        const objectLayer = template.tiledJson?.layers?.find((layer) => layer.name === "Objects");
        assert.ok(
          objectLayer?.properties?.some(
            (property) => property.name === "officeEnvironment" && property.value === "trading",
          ),
        );
        return { template: { id: "template-created" } } as T;
      }
      return base.request<T>(method, requestPath, body);
    },
  };

  const fixture = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);

  assert.equal(fixture.channelId, "channel-1");
  assert.deepEqual(calls, [
    "register",
    "character",
    "gateway",
    "profile:sophie",
    "profile:noah",
    "group",
    "template",
    "template:create",
    "channel",
    "roster",
    "board",
    "report",
  ]);
});

test("refuses non-loopback gateway URLs before making requests", async () => {
  await assert.rejects(
    () =>
      prepareFixture(
        recordingFixtureApi([]),
        "https://deskrpg.com",
        "/repo/.artifacts/readme-capture/runtime/data/db.sqlite",
      ),
    /loopback/i,
  );
});

test("refuses SQLite paths outside the capture artifact runtime", async () => {
  await assert.rejects(
    () =>
      prepareFixture(recordingFixtureApi([]), "http://127.0.0.1:38642", "/tmp/production.sqlite"),
    /readme-capture runtime/i,
  );
});
