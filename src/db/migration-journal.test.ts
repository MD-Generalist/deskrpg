import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import * as schema from "./schema";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const drizzleDir = path.join(repoRoot, "drizzle");

function journalTags(): string[] {
  const j = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8"));
  return j.entries.map((e: { tag: string }) => e.tag);
}

function sqlTags(): string[] {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}

/**
 * Drizzle 마이그레이터는 `drizzle/` 디렉토리를 스캔하지 않는다 — `meta/_journal.json`
 * 만 읽는다. 그래서 SQL 파일을 손으로 추가하면(drizzle-kit generate 없이) 그 파일은
 * **존재하는데도 실행되지 않고**, 마이그레이터는 자기가 아는 것을 다 했으므로
 * "applied successfully" 를 보고한다.
 *
 * 실제로 0004·0005 가 그렇게 넉 달 가까이 누락됐고, 스테이징에서 앱이
 * `column "local_discovery_opted_in_at" does not exist` 로 500 을 냈다. 조용한 실패가
 * 아니라 **성공을 보고하는 실패**라 배포 로그로는 알 수 없었다.
 */
test("every migration file is listed in the drizzle journal", () => {
  const missing = sqlTags().filter((t) => !journalTags().includes(t));
  assert.deepEqual(
    missing,
    [],
    "저널에 없는 마이그레이션이 있습니다 — 이 파일들은 배포해도 실행되지 않고, " +
      `마이그레이터는 성공을 보고합니다: ${missing.join(", ")}`,
  );
});

test("the journal never names a migration file that is missing", () => {
  const orphan = journalTags().filter((t) => !sqlTags().includes(t));
  assert.deepEqual(orphan, [], `저널이 없는 파일을 가리킵니다: ${orphan.join(", ")}`);
});

test("journal entries stay ordered by idx and by time", () => {
  // 마이그레이터는 이 순서대로 적용한다. 어긋나면 나중 것이 먼저 돌아 스키마가 꼬인다.
  const entries = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8"))
    .entries as { idx: number; when: number; tag: string }[];

  entries.forEach((e, i) => {
    assert.equal(e.idx, i, `idx 가 연속이 아닙니다: ${e.tag} 의 idx=${e.idx}, 기대=${i}`);
    if (i > 0) {
      assert.ok(
        e.when > entries[i - 1].when,
        `${e.tag} 의 when 이 앞 항목보다 앞섭니다 — 적용 순서가 뒤집힙니다.`,
      );
    }
  });
});

function snapshotIdxs(): number[] {
  return readdirSync(path.join(drizzleDir, "meta"))
    .filter((f) => /^\d+_snapshot\.json$/.test(f))
    .map((f) => Number(f.split("_")[0]))
    .sort((a, b) => a - b);
}

/**
 * `drizzle-kit generate` 는 **마지막 스냅샷**과 현재 `schema.ts` 의 차분을 뱉는다.
 * 손으로 쓴 SQL 은 스냅샷을 남기지 않으므로, 그런 마이그레이션이 쌓이면 스냅샷이
 * 뒤처지고 다음 `generate` 가 **이미 적용된 변경을 통째로 다시** 만들어 낸다.
 *
 * 실측(2026-09-07): 스냅샷이 0003 에서 멈춘 상태로 `generate` 를 돌렸더니
 * `ALTER TABLE "npcs" DROP COLUMN "openclaw_config";` 가 나왔다. 0005 는 같은 삭제를
 * 하되 **그 전에** 페르소나를 `agent_config` 로 옮기고 레거시 행을 백업한다.
 * 생성된 쪽에는 그 단계도 `IF EXISTS` 도 없다 — 읽지 않고 적용하면 페르소나가 사라진다.
 *
 * 손으로 SQL 을 쓰는 것 자체는 막지 않는다. 다만 **마지막 마이그레이션에는 반드시
 * 짝이 되는 스냅샷이 있어야** `generate` 가 거기서부터 차분을 잡는다.
 */
test("마지막 마이그레이션에 짝이 되는 스냅샷이 있다", () => {
  const lastMigration = journalTags().length - 1;
  const snapshots = snapshotIdxs();
  assert.ok(
    snapshots.includes(lastMigration),
    `스냅샷이 뒤처졌습니다(마지막 마이그레이션 idx ${lastMigration}, 스냅샷 ${snapshots.join(",")}). ` +
      "이 상태에서 `drizzle-kit generate` 는 이미 적용된 변경을 다시 만들어 내고, " +
      "거기엔 데이터 이전 단계가 빠진 DROP 이 섞일 수 있습니다.",
  );
});

/**
 * "마지막 마이그레이션에 짝이 되는 스냅샷이 있다" 는 스냅샷 *파일이 존재하는지* 만 본다 —
 * `drizzle-kit generate --custom` 은 새 SQL 은 손으로 쓰고 스냅샷만 자동 생성하게 해 주는데,
 * 그 스냅샷은 (custom 이므로 diff 할 스키마 변경이 없다고 보고) **직전 스냅샷을 그대로 복사**한다.
 * 즉 새 테이블을 스키마에 추가하고 SQL 도 손으로 잘 썼어도, `--custom` 으로 스냅샷을 만들면
 * 파일은 있지만 내용이 이전 것과 같아 이 시점부터 `drizzle-kit generate` 를 다시 돌리는 사람은
 * "아직 반영 안 된 변경"으로 오인해 이미 존재하는 테이블을 다시 만드는 SQL 을 뱉는다.
 * (2026-09-10 실측: 0010 스냅샷이 이 방식으로 만들어져 chat_rooms 3 테이블이 빠져 있었다.)
 */
test("최신 스냅샷의 테이블 이름이 schema.ts 가 export 하는 테이블과 같다", () => {
  const snapshots = snapshotIdxs();
  const lastIdx = snapshots[snapshots.length - 1];
  const padded = String(lastIdx).padStart(4, "0");
  const snapshotPath = path.join(drizzleDir, "meta", `${padded}_snapshot.json`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    tables: Record<string, unknown>;
  };
  const snapshotTableNames = Object.keys(snapshot.tables)
    .map((k) => k.replace(/^public\./, ""))
    .sort();

  const schemaTableNames = Object.values(schema)
    .map((t) => getTableName(t as never))
    .sort();

  assert.deepEqual(
    snapshotTableNames,
    schemaTableNames,
    "최신 스냅샷의 테이블 목록이 schema.ts 의 export 와 다릅니다 — " +
      "`drizzle-kit generate --custom` 이 직전 스냅샷을 그대로 복사했을 가능성이 큽니다. " +
      "`drizzle-kit generate`(--custom 없이) 로 스냅샷을 다시 만들고 생성된 SQL 은 버린 뒤 " +
      "손으로 쓴 SQL 을 유지하세요.\n" +
      `  스냅샷: ${JSON.stringify(snapshotTableNames)}\n` +
      `  schema.ts: ${JSON.stringify(schemaTableNames)}`,
  );
});
