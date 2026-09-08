import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

// 임시 PostgreSQL 이 있을 때만 돈다. CI 는 docker 서비스로, 로컬은
// `docker run -d --name deskrpg-migtest -e POSTGRES_PASSWORD=migtest -e POSTGRES_USER=deskrpg -e POSTGRES_DB=deskrpg -p 55437:5432 postgres:16-alpine`.
const URL = process.env.MIGRATION_TEST_DATABASE_URL;

const REPO_ROOT = path.join(__dirname, "..", "..");
const REAL_DRIZZLE_DIR = path.join(REPO_ROOT, "drizzle");
const MIGRATE_JS = path.join(REPO_ROOT, "migrate.js");

/**
 * 0007 까지만 적용하기 위한 저널 사본을 임시 디렉터리에 만든다.
 * 저장소의 실제 drizzle/meta/_journal.json 은 절대 건드리지 않는다.
 */
function makeTruncatedMigrationsDir(untilTag: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-drizzle-"));
  fs.cpSync(REAL_DRIZZLE_DIR, tmpDir, { recursive: true });

  const journalPath = path.join(tmpDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const idx = journal.entries.findIndex((e: { tag: string }) => e.tag === untilTag);
  assert.ok(idx >= 0, `저널에 ${untilTag} 가 있어야 한다`);
  journal.entries = journal.entries.slice(0, idx + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  return tmpDir;
}

test("0008 은 외형을 프로필로 옮기고 미연결 NPC 를 백업 후 지운다", { skip: !URL }, async (t) => {
  const tmpMigrationsDir = makeTruncatedMigrationsDir("0007_align_snapshot");
  t.after(() => fs.rmSync(tmpMigrationsDir, { recursive: true, force: true }));

  const pool = new Pool({ connectionString: URL });
  // drizzle 의 마이그레이션 기록은 별도 "drizzle" 스키마에 있다 — public 만 지우면
  // 이전 실행의 적용 기록이 남아 이번 실행에서 아무 마이그레이션도 다시 돌지 않는다.
  await pool.query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
  );

  // 0007 까지 적용 — 저장소 저널이 아니라 임시 사본을 가리킨다.
  execFileSync("node", [MIGRATE_JS], {
    env: { ...process.env, DATABASE_URL: URL, MIGRATIONS_DIR: tmpMigrationsDir },
    stdio: "pipe",
  });

  // 씨앗: 프로필 1, 연결 NPC 2(외형 다름), 미연결 NPC 1
  await pool.query(
    // users 에는 role 컬럼이 없다 — 실제 컬럼명은 system_role 이고 기본값이 있어 생략한다.
    `INSERT INTO users(id, login_id, nickname, password_hash) VALUES ('11111111-1111-1111-1111-111111111111','u','u','x')`,
  );
  await pool.query(
    `INSERT INTO gateway_resources(id, owner_user_id, base_url, token_encrypted, display_name) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','http://x','t','g')`,
  );
  await pool.query(
    `INSERT INTO hermes_profiles(id, gateway_id, profile_name, token_encrypted, display_name) VALUES ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','p','t','P')`,
  );
  await pool.query(
    `INSERT INTO channels(id, name, owner_id) VALUES ('44444444-4444-4444-4444-444444444444','c','11111111-1111-1111-1111-111111111111')`,
  );
  await pool.query(`INSERT INTO npcs(id, channel_id, name, position_x, position_y, appearance, hermes_profile_id, updated_at)
    VALUES ('55555555-5555-5555-5555-555555555551','44444444-4444-4444-4444-444444444444','old',1,1,'{"v":"old"}','33333333-3333-3333-3333-333333333333', now() - interval '1 day'),
           ('55555555-5555-5555-5555-555555555552','44444444-4444-4444-4444-444444444444','new',2,2,'{"v":"new"}','33333333-3333-3333-3333-333333333333', now()),
           ('55555555-5555-5555-5555-555555555553','44444444-4444-4444-4444-444444444444','orphan',3,3,'{"v":"orphan"}',NULL, now())`);

  // 0008 까지 적용 — 저장소의 실제 drizzle/ 을 그대로 쓴다.
  execFileSync("node", [MIGRATE_JS], {
    env: { ...process.env, DATABASE_URL: URL },
    stdio: "pipe",
  });

  const {
    rows: [profile],
  } = await pool.query(
    `SELECT appearance FROM hermes_profiles WHERE id='33333333-3333-3333-3333-333333333333'`,
  );
  assert.deepEqual(profile.appearance, { v: "new" }, "가장 최근 NPC 의 외형이 프로필로 가야 한다");

  const {
    rows: [{ count: orphanCount }],
  } = await pool.query(`SELECT count(*) FROM npcs WHERE hermes_profile_id IS NULL`);
  assert.equal(Number(orphanCount), 0);
  const {
    rows: [{ count: backup }],
  } = await pool.query(`SELECT count(*) FROM npcs_unprofiled_backup`);
  assert.equal(Number(backup), 1, "미연결 NPC 는 지우기 전에 백업된다");

  const {
    rows: [{ count: remaining }],
  } = await pool.query(
    `SELECT count(*) FROM npcs WHERE channel_id='44444444-4444-4444-4444-444444444444'`,
  );
  assert.equal(Number(remaining), 1, "같은 (채널, 프로필) 은 하나만 남는다");
  const {
    rows: [{ count: dup }],
  } = await pool.query(`SELECT count(*) FROM npcs_duplicate_backup`);
  assert.equal(Number(dup), 1);
  const {
    rows: [{ count: conflicts }],
  } = await pool.query(`SELECT count(*) FROM npcs_appearance_conflicts`);
  assert.equal(Number(conflicts), 1, "외형이 갈린 나머지는 conflicts 에 남는다");

  await pool.end();
});
