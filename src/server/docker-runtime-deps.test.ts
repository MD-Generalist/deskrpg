import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * server.js 는 런타임에 `import("./src/server/socket-handlers.ts")` 한다. Next 의
 * standalone 추적은 이 경로를 못 보므로 Dockerfile 이 소스를 직접 COPY 해야 하고,
 * 하나라도 빠지면 **컨테이너가 기동에서 죽는다** — 테스트도 빌드도 통과한 채로.
 * 실제로 그런 적이 있다: 2단계에서 늘어난 conversation 모듈 여덟 개가 빠져 있었다.
 */
function transitiveLocalDeps(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(path.join(repoRoot, file), "utf8");
    // 상대경로와 `@/` 별칭을 모두 본다. 별칭을 빠뜨리면 조용히 구멍이 난다 —
    // open-chat-formatter 가 `@/lib/...` 로 들어와 처음엔 추적되지 않았다.
    // `from "..."` 만 보면 CommonJS 진입점을 놓친다 — src/db/index.ts 와 server-db.js 는
    // 이관 모듈을 `require("./sqlite-...js")` 로 부르고, 그 파일들은 COPY 줄 없이
    // Next 의 standalone 추적에 얹혀 살아 있었다.
    const specs = [
      ...[...src.matchAll(/from\s+"((?:\.|@\/)[^"]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/require\(\s*"((?:\.|@\/)[^"]+)"\s*\)/g)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      const raw = spec.startsWith("@/")
        ? path.join("src", spec.slice(2))
        : path.join(path.dirname(file), spec);
      const resolved = [".ts", ".tsx", ".js", "/index.ts"]
        .map((ext) => (raw.endsWith(ext) ? raw : raw + ext))
        .find((cand) => existsSync(path.join(repoRoot, cand)));
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

test("Dockerfile copies every source file the socket server loads at runtime", () => {
  const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  // COPY 는 파일도 디렉토리도 받는다. 디렉토리 복사면 그 아래 전부가 덮인다.
  const copied = [...dockerfile.matchAll(/COPY --from=builder \/app\/(\S+)/g)].map((m) => m[1]);
  const covered = (file: string) =>
    copied.some((c) => file === c || file.startsWith(c.replace(/\/?$/, "/")));

  // 진입점은 둘이다. server.js 자체가 require 하는 것도 이미지에 있어야 한다 —
  // socket-handlers 만 훑던 때 server.js 에 새로 더한 require 가 그대로 빠져나가
  // 스테이징이 MODULE_NOT_FOUND 로 재시작 루프에 빠졌다(실측).
  const missing = [
    ...new Set([
      ...transitiveLocalDeps("src/server/socket-handlers.ts"),
      ...transitiveLocalDeps("server.js"),
    ]),
  ]
    .filter((f) => f !== "server.js" && !covered(f))
    .sort();

  assert.deepEqual(
    missing,
    [],
    "Dockerfile 이 COPY 하지 않는 런타임 의존이 있습니다 — 이미지가 기동에서 죽습니다:\n  " +
      missing.join("\n  "),
  );
});

test("Dockerfile never copies a file that no longer exists", () => {
  // 삭제된 meeting-broker.js·openclaw-gateway.js 를 계속 COPY 해 docker build 가
  // 넉 달 만에 깨졌다. 빌드는 릴리스 때만 도므로 그때까지 아무도 몰랐다.
  const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  const dead = [...dockerfile.matchAll(/COPY --from=builder \/app\/(\S+)/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes("*") && !p.startsWith(".next") && !p.startsWith("node_modules"))
    .filter((p) => !existsSync(path.join(repoRoot, p)));

  assert.deepEqual(dead, [], `Dockerfile 이 없는 경로를 COPY 합니다: ${dead.join(", ")}`);
});

test("npm allowlist includes every socket server runtime source dependency", () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    files: string[];
  };
  const missing = [...transitiveLocalDeps("src/server/socket-handlers.ts")].filter(
    (file) => !manifest.files.some((entry) => file === entry || file.startsWith(`${entry}/`)),
  );
  assert.deepEqual(missing.sort(), [], "npm package would omit runtime dependencies");
});

test("이미지의 레이어 수가 overlay2 한도에서 멀다", () => {
  // Linux 의 overlay2 는 레이어가 125개를 넘는 이미지를 풀지 못한다(`failed to register layer: max depth
  // exceeded`). 2026.921.2 가 126 레이어로 공개돼 `docker pull` 이 실패했다 — 빌드·푸시·매니페스트 확인은
  // 전부 초록이었고, 실제로 pull 해 보기 전에는 아무도 몰랐다. COPY·RUN·ADD 한 줄이 레이어 하나다.
  // 기반 이미지(node:22-bookworm-slim)가 5개 안팎을 쓰므로 여유를 크게 둔다.
  const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  const runner = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  const layers = runner.split("\n").filter((line) => /^(COPY|RUN|ADD)\b/.test(line)).length;
  assert.ok(
    layers <= 90,
    `runner 단계가 레이어 ${layers}개를 만든다 — 파일마다 COPY 하지 말고 디렉터리째 복사하라`,
  );
});
