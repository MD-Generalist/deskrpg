import test from "node:test";
import assert from "node:assert/strict";
import { ensureOfficeEnvironmentTemplate } from "./office-environment-template";
import { buildOfficeEnvironment } from "../game/three/office-environments";
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
    assert.equal(body.tags, "deskrpg-office-v1:publishing");
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
          { id: "edited", tags: "deskrpg-office-v1:trading" },
          { id: "intact", tags: "deskrpg-office-v1:trading" },
        ],
      });
    return reply({
      template: {
        cols: 30,
        rows: 22,
        spawnCol: 15,
        spawnRow: 19,
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
  const snapshot = reorderObjectKeys(buildOfficeEnvironment("tech"));
  const before = JSON.stringify(snapshot);
  const request: typeof fetch = async (url, options) => {
    assert.equal(options, undefined, "Equivalent JSONB must not register a duplicate");
    if (url === "/api/map-templates") {
      return reply({ templates: [{ id: "jsonb", tags: "deskrpg-office-v1:tech" }] });
    }
    // Return the original object so the assertion below also detects mutation.
    return {
      ok: true,
      json: async () => ({
        template: {
          cols: 30,
          rows: 22,
          spawnCol: 15,
          spawnRow: 19,
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
        return reply({ templates: [{ id: "edited", tags: "deskrpg-office-v1:tech" }] });
      }
      return reply({
        template: {
          cols: 30,
          rows: 22,
          spawnCol: 15,
          spawnRow: 19,
          tiledJson: snapshot,
        },
      });
    };
    assert.equal(await ensureOfficeEnvironmentTemplate("tech", request), "fresh");
    assert.equal(posts, 1);
  });
}
