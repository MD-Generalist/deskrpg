import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { buildOfficeEnvironment } from "../../src/game/three/office-environments";
import { CAPTURE_ACCOUNT, prepareFixture, type FixtureApi } from "./fixture";

function createCaptureDatabase(sqlitePath: string): void {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const sqlite = new Database(sqlitePath);
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      npc_id TEXT,
      assigner_id TEXT NOT NULL,
      npc_task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      auto_nudge_count INTEGER NOT NULL DEFAULT 0,
      auto_nudge_max INTEGER NOT NULL DEFAULT 5,
      last_nudged_at TEXT,
      last_reported_at TEXT,
      stalled_at TEXT,
      stalled_reason TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT
    );
    CREATE UNIQUE INDEX idx_tasks_npc_task_id ON tasks(npc_id, npc_task_id);
    CREATE TABLE npc_reports (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      npc_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      consumed_at TEXT
    );
  `);
  sqlite.close();
}

function recordingFixtureApi(
  calls: string[],
  options: { mapTemplateId?: string } = {},
): FixtureApi {
  const mapTemplateId = options.mapTemplateId ?? "template-trading";
  return {
    async request<T>(method: "GET" | "POST" | "PUT", requestPath: string, body?: unknown) {
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
      if (method === "GET" && requestPath === "/api/tasks?channelId=channel-1&npcId=npc-sophie") {
        calls.push("report");
        return [{ npcTaskId: "readme-capture-task-001", status: "completed" }] as T;
      }
      throw new Error(`Unexpected fixture request: ${method} ${requestPath}`);
    },
  };
}

function withRuntime(): { root: string; sqlitePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-fixture-"));
  const sqlitePath = path.join(root, ".artifacts/readme-capture/runtime/data/db.sqlite");
  createCaptureDatabase(sqlitePath);
  return { root, sqlitePath };
}

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
    "report",
  ]);
  assert.equal(fixture.channelId, "channel-1");
  assert.deepEqual(fixture.npcNames, ["Sophie", "Noah"]);

  const sqlite = new Database(sqlitePath, { readonly: true });
  t.after(() => sqlite.close());
  assert.deepEqual(sqlite.prepare("SELECT status, npc_id FROM tasks").get(), {
    status: "completed",
    npc_id: "npc-sophie",
  });
  assert.deepEqual(sqlite.prepare("SELECT status, target_user_id FROM npc_reports").get(), {
    status: "pending",
    target_user_id: "user-1",
  });
});

test("a second fixture run returns the same channel without duplicating capture rows", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = recordingFixtureApi([]);

  const first = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);
  const second = await prepareFixture(api, "http://127.0.0.1:38642", sqlitePath);

  assert.equal(second.channelId, first.channelId);
  const sqlite = new Database(sqlitePath, { readonly: true });
  t.after(() => sqlite.close());
  assert.equal(
    (sqlite.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count,
    1,
  );
  assert.equal(
    (sqlite.prepare("SELECT count(*) AS count FROM npc_reports").get() as { count: number }).count,
    1,
  );
});

test("an interrupted run reuses the fixed account character and channel", async (t) => {
  const { root, sqlitePath } = withRuntime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls: string[] = [];
  const base = recordingFixtureApi(calls);
  const api: FixtureApi = {
    async request<T>(
      method: "GET" | "POST" | "PUT",
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
