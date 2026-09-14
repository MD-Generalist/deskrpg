import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool, type QueryResult } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import fixture from "./fixtures/official-agency-v2.json";
import { buildOfficeEnvironment } from "../game/three/office-environments";

const sql = readFileSync("deploy/creative-studio-preservation.sql", "utf8").replace(
  ":'fixture_b64'",
  `'${Buffer.from(JSON.stringify(fixture)).toString("base64")}'`,
);
const id = "00000000-0000-0000-0000-000000000001";
const otherId = "00000000-0000-0000-0000-000000000002";
const sensitive = "PRIVATE_PAYLOAD_MUST_NOT_APPEAR";
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

test(
  "native PostgreSQL preservation detects relationship/history deletion and mutation without exposing payloads",
  { skip: !process.env.DESKRPG_TEST_PG_SOCKET },
  async (t) => {
    const pool = new Pool({
      host: process.env.DESKRPG_TEST_PG_SOCKET,
      port: Number(process.env.DESKRPG_TEST_PG_PORT ?? 55441),
      user: "task7_fix",
      database: "postgres",
      max: 1,
    });
    const tables = [
      schema.users,
      schema.hermesProfiles,
      schema.gatewayResources,
      schema.channels,
      schema.channelMembers,
      schema.npcs,
      schema.chatRooms,
      schema.chatRoomMessages,
      schema.channelGatewayBindings,
      schema.gatewayShares,
      schema.groups,
      schema.groupMembers,
      schema.chatRoomMembers,
      schema.characters,
      schema.chatMessages,
    ];
    const seedRows: Record<string, Record<string, unknown>> = {
      users: { id, password_hash: sensitive },
      hermes_profiles: { id, gateway_id: id },
      gateway_resources: { id, owner_user_id: id },
      channels: { id, group_id: id, map_data: fixture, gateway_config: { private: sensitive } },
      channel_members: { user_id: id, channel_id: id },
      npcs: { id, channel_id: id, hermes_profile_id: id },
      chat_rooms: { id, channel_id: id },
      chat_room_messages: { id, room_id: id, content: sensitive },
      channel_gateway_bindings: { id, channel_id: id, gateway_id: id, bound_by_user_id: id },
      gateway_shares: { id, gateway_id: id, user_id: id, role: "use" },
      groups: { id, name: sensitive },
      group_members: { id, group_id: id, user_id: id, role: "member" },
      chat_room_members: { room_id: id, member_kind: "user", member_id: id, invited_by: id },
      characters: { id, user_id: id, name: sensitive },
      chat_messages: { id, character_id: id, npc_id: id, role: "user", content: sensitive },
    };
    const insert = async (name: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      await pool.query(
        `INSERT INTO ${quote(name)} (${columns.map(quote).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
        Object.values(row),
      );
    };
    const reset = async () => {
      await pool.query(`TRUNCATE ${Object.keys(seedRows).map(quote).join(",")}`);
      for (const [name, row] of Object.entries(seedRows)) await insert(name, row);
      await insert("channels", { id: otherId, map_data: { edited: true } });
    };
    const snapshot = async () => {
      const results = (await pool.query(sql)) as unknown as QueryResult[];
      const rows = results.flatMap((result) => result.rows.map((row) => row.jsonb_build_object));
      assert.equal(rows.length, 3);
      assert.ok(!JSON.stringify(rows).includes(sensitive));
      return rows as Record<string, unknown>[];
    };
    try {
      // Derive every column name/type from the real schema; never invent soft-delete columns
      // or an id for chat_room_members (whose key is room/kind/member).
      for (const table of tables) {
        const config = getTableConfig(table);
        await pool.query(
          `CREATE TEMP TABLE ${quote(config.name)} (${config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}`).join(",")})`,
        );
      }
      await reset();
      const before = await snapshot();
      const cases = [
        ["channel_gateway_bindings", 1, "bindings", "bound_by_user_id", otherId],
        ["gateway_shares", 0, "gatewayShares", "role", "admin"],
        ["groups", 0, "groups", "name", "changed"],
        ["group_members", 0, "groupMembers", "role", "admin"],
        ["chat_room_members", 1, "roomMembers", "invited_by", otherId],
        ["characters", 0, "characters", "name", "changed"],
        ["chat_messages", 1, "npcMessages", "content", "changed"],
      ] as const;
      for (const [table, scope, prefix, column, value] of cases) {
        for (const operation of ["delete", "mutate"] as const) {
          await t.test(`${table}: ${operation} changes the snapshot`, async () => {
            await reset();
            if (operation === "delete") await pool.query(`DELETE FROM ${quote(table)}`);
            else await pool.query(`UPDATE ${quote(table)} SET ${quote(column)}=$1`, [value]);
            const after = await snapshot();
            assert.notDeepEqual(after, before);
            assert.notEqual(after[scope][`${prefix}Hash`], before[scope][`${prefix}Hash`]);
            assert.equal(after[scope][`${prefix}Count`], operation === "delete" ? 0 : 1);
            assert.deepEqual(after[2], before[2], "other channel scope is unchanged");
          });
        }
      }
      await t.test("stable ordering uses the composite room member key", async () => {
        await reset();
        const second = { room_id: id, member_kind: "npc", member_id: id, invited_by: id };
        await insert("chat_room_members", second);
        const ordered = await snapshot();
        await pool.query("TRUNCATE chat_room_members");
        await insert("chat_room_members", second);
        await insert("chat_room_members", seedRows.chat_room_members);
        assert.deepEqual(await snapshot(), ordered);
        assert.equal(ordered[1].roomMembersCount, 2);
      });
      await t.test("quiet map-only migration preserves every non-map category", async () => {
        await reset();
        await pool.query("UPDATE channels SET map_data=$1, updated_at=$2 WHERE id=$3", [
          buildOfficeEnvironment("agency"),
          "2026-09-15 01:02:03.123456+00",
          id,
        ]);
        const after = await snapshot();
        assert.deepEqual(after[0], before[0]);
        assert.deepEqual(after[2], before[2]);
        const changed = Object.keys(before[1])
          .filter((key) => JSON.stringify(before[1][key]) !== JSON.stringify(after[1][key]))
          .sort();
        assert.deepEqual(changed, [
          "eligibleV2",
          "environmentVersion",
          "height",
          "mapHash",
          "updatedAt",
          "width",
        ]);
        assert.equal(after[1].width, 42);
        assert.equal(after[1].height, 26);
        assert.equal(after[1].environmentVersion, 3);
        // Rename belongs to a subsequent, separately named baseline, not migration acceptance.
        await pool.query("UPDATE channels SET name='rename authority test' WHERE id=$1", [id]);
        const renamed = await snapshot();
        assert.equal(renamed[1].mapHash, after[1].mapHash);
        assert.notEqual(renamed[1].nonMapHash, after[1].nonMapHash);
      });
    } finally {
      await pool.end();
    }
  },
);
