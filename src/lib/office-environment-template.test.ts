import test from "node:test";
import assert from "node:assert/strict";
import { ensureOfficeEnvironmentTemplate } from "./office-environment-template";
import { buildOfficeEnvironment } from "../game/three/office-environments";
import { effectiveMapSpawn } from "./effective-map-spawn";
import { validateMapTemplate } from "./map-editor-utils";

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("registers valid selected environment with existing template API", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url, options) => {
    calls.push(String(url));
    if (!options) return reply({ templates: [] });
    const body = JSON.parse(String(options.body));
    assert.equal(validateMapTemplate(body), null);
    assert.deepEqual(body.tiledJson, buildOfficeEnvironment("publishing"));
    assert.equal(body.tags, "deskrpg-office-v2:publishing");
    return reply({ template: { id: "saved-template" } }, 201);
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("publishing", request), "saved-template");
  assert.deepEqual(calls, ["/api/map-templates", "/api/map-templates"]);
});

test("reuses exact snapshot, accepts SQLite JSON, and never overwrites edited templates", async () => {
  let posted = false;
  const request: typeof fetch = async (url, options) => {
    if (options) {
      posted = true;
      return reply({ template: { id: "new" } });
    }
    if (url === "/api/map-templates")
      return reply({
        templates: [
          { id: "edited", tags: "deskrpg-office-v3:trading" },
          { id: "intact", tags: "deskrpg-office-v3:trading" },
        ],
      });
    return reply({
      template: {
        cols: buildOfficeEnvironment("trading").width,
        rows: buildOfficeEnvironment("trading").height,
        spawnCol: effectiveMapSpawn(buildOfficeEnvironment("trading"))!.col,
        spawnRow: effectiveMapSpawn(buildOfficeEnvironment("trading"))!.row,
        tiledJson:
          url === "/api/map-templates/edited"
            ? "{}"
            : JSON.stringify(buildOfficeEnvironment("trading")),
      },
    });
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("trading", request), "intact");
  assert.equal(posted, false);
});

test("invalid choice and failed registration do not produce a usable template ID", async () => {
  await assert.rejects(
    ensureOfficeEnvironmentTemplate("unknown", async () => {
      throw new Error("unexpected request");
    }),
    /Unknown office/,
  );
  await assert.rejects(
    ensureOfficeEnvironmentTemplate("agency", async () => reply({}, 500)),
    /Unable to load/,
  );
  await assert.rejects(
    ensureOfficeEnvironmentTemplate("tech", async (_url, options) =>
      options ? reply({}, 403) : reply({ templates: [] }),
    ),
    /Unable to prepare/,
  );
});

function reorderObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reorderObjectKeys(child)]),
    );
  }
  return value;
}

test("reuses PostgreSQL JSONB snapshots despite recursively reordered object keys", async () => {
  const map = buildOfficeEnvironment("tech");
  const snapshot = reorderObjectKeys(map);
  const before = JSON.stringify(snapshot);
  const request: typeof fetch = async (url, options) => {
    assert.equal(options, undefined, "Equivalent JSONB must not register a duplicate");
    if (url === "/api/map-templates") {
      return reply({ templates: [{ id: "jsonb", tags: "deskrpg-office-v3:tech" }] });
    }
    // Return the original object so the assertion below also detects mutation.
    return {
      ok: true,
      json: async () => ({
        template: {
          cols: map.width,
          rows: map.height,
          spawnCol: effectiveMapSpawn(map)!.col,
          spawnRow: effectiveMapSpawn(map)!.row,
          tiledJson: snapshot,
        },
      }),
    } as Response;
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("tech", request), "jsonb");
  assert.equal(JSON.stringify(snapshot), before);
});

for (const change of ["nested value", "array order"] as const) {
  test(`registers a new snapshot when ${change} differs after object-key reordering`, async () => {
    const map = buildOfficeEnvironment("tech");
    if (change === "nested value") map.layers[0].name += " edited";
    else map.layers.reverse();
    const snapshot = reorderObjectKeys(map);
    let posts = 0;
    const request: typeof fetch = async (url, options) => {
      if (options) {
        assert.equal(options.method, "POST");
        assert.equal(String(url), "/api/map-templates");
        assert.deepEqual(
          JSON.parse(String(options.body)).tiledJson,
          buildOfficeEnvironment("tech"),
        );
        posts++;
        return reply({ template: { id: "fresh" } });
      }
      if (url === "/api/map-templates") {
        return reply({ templates: [{ id: "edited", tags: "deskrpg-office-v3:tech" }] });
      }
      return reply({
        template: {
          cols: map.width,
          rows: map.height,
          spawnCol: effectiveMapSpawn(map)!.col,
          spawnRow: effectiveMapSpawn(map)!.row,
          tiledJson: snapshot,
        },
      });
    };
    assert.equal(await ensureOfficeEnvironmentTemplate("tech", request), "fresh");
    assert.equal(posts, 1);
  });
}

test("room rollout creates v2 separately and never reads or updates legacy v1 templates", async () => {
  for (const id of ["trading", "agency", "tech", "executive"]) {
    const calls: string[] = [];
    const request: typeof fetch = async (url, options) => {
      calls.push(`${options?.method ?? "GET"} ${url}`);
      if (!options)
        return reply({
          templates: [{ id: "existing-channel-template", tags: `deskrpg-office-v1:${id}` }],
        });
      assert.equal(options.method, "POST");
      assert.equal(
        JSON.parse(String(options.body)).tags,
        `deskrpg-office-v${id === "agency" ? 5 : id === "tech" || id === "trading" ? 3 : 2}:${id}`,
      );
      return reply({ template: { id: "new-room-template" } }, 201);
    };
    assert.equal(await ensureOfficeEnvironmentTemplate(id, request), "new-room-template");
    assert.deepEqual(calls, ["GET /api/map-templates", "POST /api/map-templates"]);
  }
});

test("agency skips old evidence and registers v5 with the actual Tiled entrance spawn", async () => {
  const request: typeof fetch = async (url, options) => {
    if (!options) {
      assert.equal(url, "/api/map-templates");
      return reply({ templates: [{ id: "legacy", tags: "deskrpg-office-v2:agency" }] });
    }
    const body = JSON.parse(String(options.body));
    assert.equal(body.tags, "deskrpg-office-v5:agency");
    assert.equal(body.spawnCol, 23);
    assert.equal(body.spawnRow, 23);
    return reply({ template: { id: "v5" } });
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("agency", request), "v5");
});

test("tech keeps the v2 template intact and registers the v3 reference layout", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    if (!options)
      return reply({ templates: [{ id: "legacy-tech", tags: "deskrpg-office-v2:tech" }] });
    const body = JSON.parse(String(options.body));
    assert.equal(body.tags, "deskrpg-office-v3:tech");
    assert.deepEqual(body.tiledJson, buildOfficeEnvironment("tech"));
    assert.equal(validateMapTemplate(body), null);
    return reply({ template: { id: "tech-v3" } });
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("tech", request), "tech-v3");
  assert.deepEqual(calls, ["GET /api/map-templates", "POST /api/map-templates"]);
});

test("wide official layouts do not relax size bounds for edited or forged maps", () => {
  for (const id of ["agency", "tech", "trading"] as const) {
    const map = buildOfficeEnvironment(id);
    const body = {
      name: id,
      cols: map.width,
      rows: map.height,
      spawnCol: effectiveMapSpawn(map)!.col,
      spawnRow: effectiveMapSpawn(map)!.row,
      tiledJson: map,
    };
    assert.equal(validateMapTemplate(body), null);
    const edited = structuredClone(map);
    edited.layers.reverse();
    assert.equal(validateMapTemplate({ ...body, tiledJson: edited }), "cols must be 10-40");
    assert.equal(validateMapTemplate({ ...body, tiledJson: {} }), "cols must be 10-40");
    assert.equal(validateMapTemplate({ ...body, cols: 200 }), "cols must be 10-40");
  }
});

test("trading keeps the v2 template intact and registers the v3 reference layout", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    if (!options)
      return reply({ templates: [{ id: "legacy-trading", tags: "deskrpg-office-v2:trading" }] });
    const body = JSON.parse(String(options.body));
    assert.equal(body.tags, "deskrpg-office-v3:trading");
    assert.deepEqual(body.tiledJson, buildOfficeEnvironment("trading"));
    assert.equal(validateMapTemplate(body), null);
    return reply({ template: { id: "trading-v3" } });
  };
  assert.equal(await ensureOfficeEnvironmentTemplate("trading", request), "trading-v3");
  assert.deepEqual(calls, ["GET /api/map-templates", "POST /api/map-templates"]);
});
