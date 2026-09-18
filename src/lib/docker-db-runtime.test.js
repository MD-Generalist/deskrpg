import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Docker runtime makes PostgreSQL selection explicit before migrations and server startup", () => {
  const entrypoint = readFileSync(path.join(root, "docker-entrypoint.sh"), "utf8");
  const inference = entrypoint.indexOf("export DB_TYPE=postgresql");
  const migration = entrypoint.indexOf("node /app/migrate.js");
  const server = entrypoint.indexOf("exec node --import tsx server.js");

  assert.ok(inference >= 0, "DATABASE_URL deployments must export DB_TYPE=postgresql");
  assert.ok(inference < migration, "DB dialect must be selected before migrations");
  assert.ok(inference < server, "DB dialect must be selected before Next.js starts");
});

for (const relative of [
  "docker-compose.test.yml",
  "docker/docker-compose.dev.yml",
  "docker/docker-compose.external.yml",
]) {
  test(`${relative} declares the PostgreSQL dialect`, () => {
    const compose = readFileSync(path.join(root, relative), "utf8");
    assert.match(compose, /DB_TYPE:\s*postgresql/);
    assert.match(compose, /DATABASE_URL:\s*postgresql:/);
  });
}

test("an explicit DB_TYPE survives the runtime home's DB_TYPE=sqlite line", () => {
  const { applyEnvText } = createRequire(import.meta.url)("./runtime-env-bootstrap.js");
  const home = "DB_TYPE=sqlite\nSQLITE_PATH=/app/data/data/deskrpg.db\n";

  const explicit = { DB_TYPE: "postgresql", DATABASE_URL: "postgresql://x" };
  applyEnvText(home, explicit);
  assert.equal(explicit.DB_TYPE, "postgresql");

  // 이것이 운영에서 본 실패다 — 방언이 비어 있으면 홈 파일의 sqlite 가 이긴다.
  const inferred = { DATABASE_URL: "postgresql://x" };
  applyEnvText(home, inferred);
  assert.equal(inferred.DB_TYPE, "sqlite");
});
