import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { channels } from "../db/schema";
import fixture from "./fixtures/official-agency-v2.json";
import {
  channelRowRevisionExpression,
  mapContentRevision,
  mapUpgradeCondition,
} from "./channel-map-revision";
import { buildOfficeEnvironment } from "../game/three/office-environments";

test(
  "native PostgreSQL CAS preserves microseconds and rejects concurrent editor writes",
  { skip: !process.env.DESKRPG_TEST_PG_SOCKET },
  async () => {
    const pool = new Pool({
      host: process.env.DESKRPG_TEST_PG_SOCKET,
      port: Number(process.env.DESKRPG_TEST_PG_PORT ?? 55441),
      user: "task7_fix",
      database: "postgres",
      max: 1,
    });
    try {
      await pool.query(
        "CREATE TEMP TABLE channels (id uuid PRIMARY KEY, map_data jsonb, updated_at timestamptz DEFAULT now())",
      );
      const db = drizzle(pool);
      const id = "00000000-0000-0000-0000-000000000001";
      const load = async () =>
        (
          await db
            .select({
              id: channels.id,
              mapData: channels.mapData,
              updatedAt: channels.updatedAt,
              rowRevision: channelRowRevisionExpression(channels.updatedAt, true),
            })
            .from(channels)
        )[0];
      for (const timestamp of ["2026-09-14 01:02:03.123456+00", "2026-09-14 01:02:03.123000+00"]) {
        await pool.query("TRUNCATE channels");
        await pool.query("INSERT INTO channels VALUES($1,$2,$3)", [id, fixture, timestamp]);
        const row = await load();
        assert.equal(mapContentRevision(row.mapData), mapContentRevision(JSON.stringify(fixture)));
        const saved = await db
          .update(channels)
          .set({ mapData: buildOfficeEnvironment("agency"), updatedAt: new Date() })
          .where(mapUpgradeCondition(channels, row, true))
          .returning({ mapData: channels.mapData });
        assert.equal(saved.length, 1, timestamp);
        assert.notEqual(mapContentRevision(saved[0].mapData), mapContentRevision(row.mapData));
        assert.equal((saved[0].mapData as { width: number }).width, 42);
      }
      await pool.query("UPDATE channels SET map_data=$1,updated_at=$2", [
        fixture,
        "2026-09-14 01:02:03.123456+00",
      ]);
      const selected = await load();
      await pool.query("UPDATE channels SET map_data=$1,updated_at=$2", [
        { edited: true },
        "2026-09-14 01:02:03.123457+00",
      ]);
      assert.equal(
        (
          await db
            .update(channels)
            .set({ mapData: buildOfficeEnvironment("agency") })
            .where(mapUpgradeCondition(channels, selected, true))
            .returning({ mapData: channels.mapData })
        ).length,
        0,
      );
      assert.deepEqual((await load()).mapData, { edited: true });
      // A concurrent non-map writer can change only the microsecond remainder.
      await pool.query("UPDATE channels SET map_data=$1,updated_at=$2", [
        fixture,
        "2026-09-14 01:02:03.123456+00",
      ]);
      const precise = await load();
      await pool.query("UPDATE channels SET updated_at=$1", ["2026-09-14 01:02:03.123457+00"]);
      assert.equal(mapContentRevision((await load()).mapData), mapContentRevision(precise.mapData));
      assert.equal(
        (
          await db
            .update(channels)
            .set({ mapData: buildOfficeEnvironment("agency") })
            .where(mapUpgradeCondition(channels, precise, true))
            .returning({ mapData: channels.mapData })
        ).length,
        0,
      );
    } finally {
      await pool.end();
    }
  },
);
