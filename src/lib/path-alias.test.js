import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * 배포본이 죽던 조건을 그대로 만든다: 소스가 `node_modules` 안에 있을 때 `@/...` 가 풀리는가.
 * tsx 는 node_modules 안의 파일에 tsconfig paths 를 적용하지 않으므로, 우리 리졸버가 없으면
 * 여기서 Cannot find module 이 난다(실측: 2026.9.18·2026.9.19).
 */
function inNodeModules(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-alias-"));
  const pkg = path.join(root, "node_modules", "deskrpg");
  fs.mkdirSync(path.join(pkg, "src", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(import.meta.dirname, "path-alias.js"),
    path.join(pkg, "src", "lib", "path-alias.js"),
  );
  fs.writeFileSync(path.join(pkg, "src", "db.js"), "module.exports = { marker: 'db' };\n");
  fs.writeFileSync(path.join(pkg, "probe.js"), body);
  try {
    return execFileSync(process.execPath, [path.join(pkg, "probe.js")], {
      encoding: "utf8",
    }).trim();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("node_modules 안에서도 @/ 별칭이 패키지의 src 로 풀린다", () => {
  const out = inNodeModules(`
    require("./src/lib/path-alias.js").installPathAlias(__dirname);
    console.log(require("@/db").marker);
  `);
  assert.equal(out, "db");
});

test("별칭이 아닌 요청은 건드리지 않는다", () => {
  const out = inNodeModules(`
    require("./src/lib/path-alias.js").installPathAlias(__dirname);
    console.log(typeof require("node:path").join);
  `);
  assert.equal(out, "function");
});

test("없는 별칭은 원래 오류를 그대로 낸다", () => {
  const out = inNodeModules(`
    require("./src/lib/path-alias.js").installPathAlias(__dirname);
    try { require("@/nope"); } catch (error) { console.log(error.code); }
  `);
  assert.equal(out, "MODULE_NOT_FOUND");
});

test("두 번 설치해도 리졸버가 겹쳐 쌓이지 않는다", () => {
  const out = inNodeModules(`
    const alias = require("./src/lib/path-alias.js");
    const Module = require("node:module");
    alias.installPathAlias(__dirname);
    const first = Module._resolveFilename;
    alias.installPathAlias(__dirname);
    console.log(first === Module._resolveFilename);
  `);
  assert.equal(out, "true");
});
