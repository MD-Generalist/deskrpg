import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const { ensureSqliteBaseSchema } = require("./sqlite-base-schema.js") as {
  ensureSqliteBaseSchema: (db: Database.Database) => void;
};
const { ensureProjectRegistry } = require("./sqlite-project-registry.js") as {
  ensureProjectRegistry: (db: Database.Database) => void;
};

for (const legacy of [false, true]) {
  test(`handoff column and one pending record per channel survive ${legacy ? "existing" : "empty"} SQLite boot`, () => {
    const db = new Database(":memory:");
    try {
      ensureSqliteBaseSchema(db);
      if (legacy)
        db.exec("ALTER TABLE channel_kanban_boards DROP COLUMN event_carrier_handoff_json");
      ensureProjectRegistry(db);
      ensureProjectRegistry(db);
      const columns = db.pragma("table_info(channel_kanban_boards)") as Array<{ name: string }>;
      assert.ok(columns.some(({ name }) => name === "event_carrier_handoff_json"));
      db.pragma("foreign_keys = OFF");
      const addBoard = db.prepare(`INSERT INTO channel_kanban_boards
        (id, channel_id, gateway_id, board_slug, event_cursor, created_at, updated_at)
        VALUES (?, ?, 'gateway', ?, ?, 'now', 'now')`);
      addBoard.run("a", "channel", "a", "cursor-a");
      addBoard.run("b", "channel", "b", "cursor-b");
      addBoard.run("c", "other", "c", "cursor-c");
      db.prepare(
        "UPDATE channel_kanban_boards SET event_carrier_handoff_json = ? WHERE id = ?",
      ).run('{"version":1}', "a");
      assert.throws(
        () =>
          db
            .prepare("UPDATE channel_kanban_boards SET event_carrier_handoff_json = ? WHERE id = ?")
            .run('{"version":1}', "b"),
        /UNIQUE constraint failed/,
      );
      db.prepare(
        "UPDATE channel_kanban_boards SET event_carrier_handoff_json = ? WHERE id = ?",
      ).run('{"version":1}', "c");
      const rows = db
        .prepare(
          "SELECT id, event_cursor AS cursor, event_carrier_handoff_json AS handoff FROM channel_kanban_boards ORDER BY id",
        )
        .all() as Array<{ id: string; cursor: string; handoff: string | null }>;
      assert.deepEqual(
        rows.map(({ id, cursor, handoff }) => [id, cursor, handoff]),
        [
          ["a", "cursor-a", '{"version":1}'],
          ["b", "cursor-b", null],
          ["c", "cursor-c", '{"version":1}'],
        ],
      );
    } finally {
      db.close();
    }
  });
}
