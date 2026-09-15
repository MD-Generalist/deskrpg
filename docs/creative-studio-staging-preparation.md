# Creative studio staging preparation

These commands are prepared for the controller; none is an instruction to deploy production. This task has not executed them remotely. Staging is `https://test.deskrpg.com`, with source synced by `deploy/test-deploy.sh` to `/home/dante/projects/deskrpg-test/build-context` on `${DESKRPG_TEST_REMOTE:-DanteServer}`. Confirm the existing compose service names with `docker compose config --services` before substituting the database service below; do not assume the local test-compose names match the hosted stack.

## Phase 0: archive before schema or map migration

1. Commit/review the verified work and push `master` only when the controller authorizes it. Do not create a date tag, production release or Docker Hub push. Record the exact commit and current staging image digest for rollback.
2. Quiesce staging channel activity and stop only the staging app while leaving its PostgreSQL service running. Do not use `down -v`. Record existing users, profiles, memberships, chat and gateway state before opening any channel with the new code.
3. On the MiniPC, provision durable storage outside `build-context` (the deploy script uses `rsync --delete` there). App UID/GID are 1001:1001 in the Dockerfile:

```bash
cd /home/dante/projects/deskrpg-test
docker compose stop deskrpg-test-app
sudo install -d -m 0700 -o 1001 -g 1001 /home/dante/projects/deskrpg-test/map-backups
install -d -m 0700 /home/dante/projects/deskrpg-test/pre-studio-backup
umask 077
# Replace with the database service printed by `docker compose config --services`.
DESKRPG_STAGING_DB_SERVICE='<confirmed-database-service>'
docker compose exec -T "$DESKRPG_STAGING_DB_SERVICE" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > pre-studio-backup/database.dump
test -s pre-studio-backup/database.dump
docker compose exec -T "$DESKRPG_STAGING_DB_SERVICE" pg_restore --list < pre-studio-backup/database.dump > pre-studio-backup/database.contents
sha256sum pre-studio-backup/database.dump > pre-studio-backup/database.sha256
```

The dump includes every channel map, therefore every eligible v2 map, before lazy upgrade is enabled. It contains sensitive application data: keep mode 0600, do not attach it to reports, and retain it independently of container/build-context replacement. Listing the archive validates its structure; the controller must also restore it into a disposable database and verify counts before declaring rollback tested.

4. Copy both `deploy/creative-studio-preservation.sql` and `deploy/creative-studio-bootstrap-check.sql` separately into `pre-studio-backup/`; the deploy script deliberately excludes `deploy/` and `docs/`. The canonical fixture can be copied from the verified checkout before deployment. Verify its SHA-256 is `d17e2d0a8e7900e2ad5cfe879c9dc406bcb9dbadc6fdedc2d85e42663fc9015f`.

```bash
# Run on Linux with the verified fixture copied to this private backup directory.
fixture_b64="$(base64 -w0 pre-studio-backup/official-agency-v2.json)"
docker compose exec -T "$DESKRPG_STAGING_DB_SERVICE" sh -c 'exec psql -X -A -t -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v fixture_b64="$1"' sh "$fixture_b64" < pre-studio-backup/creative-studio-bootstrap-check.sql > pre-studio-backup/before-schema.json
unset fixture_b64
```

The bootstrap query records schema flags, exact-v2/version counts and a stable hash over **every channel ID and map**, without outputting maps. This pre-schema record proves that startup did not upgrade any map; it is not the whole-row preservation baseline.

## Phase 1: schema-only startup with map upgrades disabled

Before the first new-code startup, remove `DESKRPG_MAP_BACKUP_DIR` from every staging app environment source, or explicitly set it to an empty string in the auto-loaded compose override to neutralize inherited configuration. Do not configure the writable backup mount yet. Empty/unset configuration fails closed in the map upgrader. A shell-only `unset` is insufficient if compose or its env file supplies the value.

With the archive restore test complete, the controller runs `npm run deploy:test` from the verified checkout. The Linux app entrypoint applies PostgreSQL schema migrations before starting the server. Confirm app/database health and final HTTP 200 after redirects, but keep users and automated event producers quiet. Verify the actual running app has no effective backup directory, without printing its environment:

```bash
docker compose exec -T deskrpg-test-app node -e 'if (process.env.DESKRPG_MAP_BACKUP_DIR) throw Error("Map upgrades must remain disabled during schema bootstrap"); console.log("Map upgrade configuration is disabled")'
docker compose stop deskrpg-test-app
fixture_b64="$(base64 -w0 pre-studio-backup/official-agency-v2.json)"
docker compose exec -T "$DESKRPG_STAGING_DB_SERVICE" sh -c 'exec psql -X -A -t -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v fixture_b64="$1"' sh "$fixture_b64" < pre-studio-backup/creative-studio-bootstrap-check.sql > pre-studio-backup/after-schema.json
unset fixture_b64
python3 - <<'CHECK'
import json
from pathlib import Path
root = Path("pre-studio-backup")
before = json.loads((root / "before-schema.json").read_text())
after = json.loads((root / "after-schema.json").read_text())
for key in ["gatewayPluginInfoColumn", "roomNoticeColumn", "channelKanbanBoardsTable", "cronJobOriginsTable", "legacyTasksAbsent", "legacyNpcReportsAbsent"]:
    assert after[key] is True, "Schema migration incomplete: " + key
for key in ["channelsCount", "exactV2Count", "version2Count", "version3Count", "otherVersionCount", "mapRowsHash"]:
    assert before[key] == after[key], "A map changed during schema-only startup: " + key
print("Schema state verified; all channel maps unchanged during bootstrap")
CHECK
```

Require 0011's `gateway_resources.plugin_info_json`, `chat_room_messages.notice_json`, `channel_kanban_boards` and `cron_job_origins` to exist, and 0012's retired `tasks`/`npc_reports` tables to be absent. Migration 0012 intentionally removes the retired tables; retain their pre-schema archive and tested restore separately. This reviewed schema transition is distinct from exact-map upgrade acceptance.

With the app stopped and all schema changes complete, create the **quiet post-schema/pre-map baseline**:

```bash
fixture_b64="$(base64 -w0 pre-studio-backup/official-agency-v2.json)"
docker compose exec -T "$DESKRPG_STAGING_DB_SERVICE" sh -c 'exec psql -X -A -t -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v fixture_b64="$1"' sh "$fixture_b64" < pre-studio-backup/creative-studio-preservation.sql > pre-studio-backup/before.ndjson
unset fixture_b64
```

`before.ndjson` must be taken here, **after schema bootstrap and before map migration**. Adding even a null column changes `to_jsonb(row)` and its whole-row hash; a pre-deployment snapshot cannot be the comparator for this check. Preserve both bootstrap records to prove no map upgraded before this baseline. Do not omit the new columns from hashes or waive unrelated differences to make comparison pass.

The query emits only IDs, dimensions, eligibility flags, counts and integrity hashes. The global record covers users, profiles, gateway resources, actual gateway shares, groups, group memberships and characters, including currently unbound/unassigned rows. Each channel covers all channel fields except `map_data`/`updated_at`, channel memberships, actual gateway bindings, NPC/profile assignments/homes, room rows, room memberships and both room messages and NPC chat history. NPC history (`chat_messages`) joins through `npcs.channel_id`; the current schema has no soft-delete column, so every persisted row is included. Room memberships use the full `(room_id, member_kind, member_id)` composite key for stable ordering. Every category has a count and full-row hash; hashes cannot be replaced by checking only the channel’s legacy gateway configuration. `eligibleV2` uses exact PostgreSQL JSONB equality to the frozen fixture. No version-tag-only eligibility shortcut is used.

## Phase 2: enable durable map backup and restart

Only after the schema/map proof and `before.ndjson` baseline succeed, add the following to the existing **staging** compose app service (`deskrpg-test-app`). Do not overwrite the rest of its environment, volumes or secrets. Keep it in the existing compose file or in an auto-loaded `docker-compose.override.yml`; the deployment script calls plain `docker compose up` and will not load an arbitrary override filename.

```yaml
services:
  deskrpg-test-app:
    environment:
      DESKRPG_MAP_BACKUP_DIR: /var/lib/deskrpg/map-backups
    volumes:
      - /home/dante/projects/deskrpg-test/map-backups:/var/lib/deskrpg/map-backups
```

The directory must exist and be writable by UID 1001. Validate compose without printing resolved secrets: `docker compose config --quiet`. Confirm the mount source/destination after recreation through `docker inspect` using only mount fields. Confirm fsync/rename/write permissions as the app user before opening an eligible channel. The ordinary container writable layer and `/tmp` do not satisfy this contract.

Restart the stopped app with the reviewed same image and new backup configuration: `docker compose up -d --no-deps --force-recreate deskrpg-test-app`. Keep users and background writers quiet. Run this write/fsync/rename probe after recreation and before opening an eligible channel:

```bash
docker compose exec -T --user 1001:1001 deskrpg-test-app node <<'NODE'
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const directory = process.env.DESKRPG_MAP_BACKUP_DIR;
if (!directory || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw Error("Backup directory unavailable");
const pending = path.join(directory, ".probe-" + crypto.randomUUID());
const done = pending + ".done";
const file = fs.openSync(pending, "wx", 0o600);
try { fs.writeSync(file, "storage probe"); fs.fsyncSync(file); } finally { fs.closeSync(file); }
fs.renameSync(pending, done);
const dir = fs.openSync(directory, "r");
try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
if ((fs.statSync(done).mode & 0o777) !== 0o600) throw Error("Backup mode must be 0600");
fs.unlinkSync(done);
console.log("Backup storage probe passed");
NODE
```

The probe establishes app-user filesystem behavior. The separate bind-mount inspection establishes that storage is durable; neither check replaces the other.

Keep **one socket authority**. No independently scaled socket replicas may serve these channels during upgrade. Missing directory, failed fsync, unwritable storage or unavailable coordination must leave the v2 row unchanged. With the feature disabled, do not interpret a successfully loaded old map as migration acceptance.

## Phase 3: quiet map-preservation acceptance

The schema-only deployment is already complete. Confirm the restarted app is healthy and still uses the same schema. No schema changes may occur between the Phase 1 `before.ndjson` baseline and this map-only comparison; if any do, stop and establish a new quiet post-schema/pre-map baseline before upgrading maps.

Open one recorded exact-v4 channel with two existing browser sessions. Observe `map:refresh` begin/ready, one durable map backup, cache/reservation/continuation reset and the new 42×26/version-5 map. Repeat the database-path probes with exact-v2 and exact-v3 fixtures. Fetching an edited v2, v3 or v4 channel must preserve its exact map hash and legacy rendering. Keep the sessions idle and do not rename, send chat, move actors or replace maps during this quiet preservation window. Authority/interaction tests run only after the comparison below passes.

While staging remains quiet, rerun the same preservation query into `after.ndjson`. Compare by channel ID:

- The global record and every count/hash outside map state must be identical.
- For the opened eligible channel, only `mapHash`, `updatedAt`, width/height/version and the derived eligibility flag may differ; width=42, height=26 and environmentVersion=5 are required.
- Unopened or edited channels must have unchanged map hashes and timestamps. Do not waive changed channel/group/room memberships, characters, profiles, NPC homes, gateway bindings/shares/config or either chat table as migration side effects. Investigate unrelated activity separately and repeat a quiet snapshot window.
- Keep the original database dump and each per-map backup; verify the map backup contains the original exact map and was created before the successful row change. Record filenames/hashes, never raw contents, in the delivery report.

Complete and record the successful `before.ndjson` versus `after.ndjson` comparison before proceeding. A changed `nonMapHash` fails migration acceptance, including a channel rename.

## Post-preservation authority and interaction acceptance

Only after the quiet comparison passes, test old/absent/empty revision rejection and fresh authorized bootstrap. Record that the admitted v3 client emits an NPC update before the rename. Pause activity again and run the same query into a new named `before-rename.ndjson` baseline; never overwrite the migration snapshots. Rename the channel through its normal API, capture `after-rename.ndjson` before further interaction, then verify the same admitted client still delivers NPC updates and retains its map-content revision. In this separate rename comparison, only that channel's `nonMapHash` and `updatedAt` may change; all map fields, counts, relationship/history hashes and other channel/global records must stay equal. Retain the requested metadata field change and API response as evidence without logging private payloads. Perform the actual map-replacement test afterward and confirm it invalidates the old revision.

Then run the staging browser/interaction/performance checklist in `deploy/pre-deploy-checklist.md` and `docs/design/three-asset-quality-checklist.md`. Local fixture evidence does not replace authenticated staging migration, temporary-seat ownership or persistence checks.

Rollback: disable the backup-directory environment to stop further automatic upgrades, quiesce the affected channel, retain its current map as another backup, restore only its original map using an optimistic current-map/revision predicate, restart the socket authority and reload clients. Do not restore the full database over newer unrelated data. If finish transport failed, inspect the saved map and durable backup before retrying/restarting; a 500 response may follow a successful map write.
