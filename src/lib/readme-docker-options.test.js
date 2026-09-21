// README 의 Docker 안내가 실제로 HTTP 로 뜨는 compose 를 가리키는지 본다.
//
// 2026-09-17 에 루트 `docker-compose.yml` 이 Hostinger(Traefik·HTTPS) 전용으로 바뀌었는데 README 의
// 일반 Docker 안내는 그대로였다. 그 안내를 따른 셀프호스터는 **접속할 포트가 없고**, 포트를 직접
// 열어도 `COOKIE_SECURE` 기본값이 `true` 라 HTTP 에서 로그인 쿠키가 버려진다. 문서와 파일이 따로
// 움직여 생긴 결함이라, 문서를 고치는 것만으로는 다음번을 막지 못한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const READMES = ["README.md", "README.ko.md"];

/** README 안의 `docker compose …` 명령 줄 전부. */
function composeCommands(readme) {
  return readme.split(/\r?\n/).filter((line) => line.trim().startsWith("docker compose "));
}

for (const name of READMES) {
  const readme = fs.readFileSync(path.join(ROOT, name), "utf8");
  const commands = composeCommands(readme);

  test(`${name} — docker compose 안내가 있다`, () => {
    assert.ok(commands.length > 0, "안내가 사라졌으면 아래 검사들이 조용히 무의미해진다");
  });

  test(`${name} — 모든 docker compose 안내가 -f 로 파일을 지정한다 — 루트 compose 는 Hostinger 전용이다`, () => {
    for (const command of commands)
      assert.match(
        command,
        /-f docker\/docker-compose\.[a-z]+\.yml/,
        `파일 지정이 없다: ${command}`,
      );
  });

  test(`${name} — 가리키는 compose 파일이 존재하고, HTTP 포트를 열고, COOKIE_SECURE 기본값이 false 다`, () => {
    const files = new Set(
      commands.flatMap((command) => command.match(/docker\/docker-compose\.[a-z]+\.yml/g) ?? []),
    );
    assert.ok(files.size > 0);
    for (const file of files) {
      const full = path.join(ROOT, file);
      assert.ok(fs.existsSync(full), `${file} 가 없다`);
      const compose = fs.readFileSync(full, "utf8");
      assert.match(compose, /^\s+ports:/m, `${file} 가 포트를 열지 않는다 — 접속할 곳이 없다`);
      assert.match(
        compose,
        /COOKIE_SECURE: \$\{COOKIE_SECURE:-false\}/,
        `${file} 의 COOKIE_SECURE 기본값이 false 가 아니다 — HTTP 에서 로그인이 막힌다`,
      );
    }
  });

  test(`${name} — 그 compose 가 저장소 파일을 마운트하므로 clone 안내가 함께 있다`, () => {
    // `../public/assets` 를 마운트한다 — 저장소 밖에서 돌리면 compose 가 경로를 못 찾는다.
    assert.match(readme, /git clone https:\/\/github\.com\/dandacompany\/deskrpg\.git/);
  });
}

test("루트 docker-compose.yml 은 여전히 Hostinger 전용이다 — 이 테스트의 전제", () => {
  const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  assert.doesNotMatch(compose, /^\s+ports:/m, "포트가 생겼다면 README 안내를 다시 판단한다");
  assert.match(compose, /COOKIE_SECURE: \$\{COOKIE_SECURE:-true\}/);
});

test("server.js 는 COOKIE_SECURE 가 없으면 false 로 둔다 — npm·단독 docker run 은 HTTP 다", () => {
  // 이 파일은 standalone 번들의 진입점이라 불러들이면 Next 빌드 산출물을 찾는다.
  // 그래서 내용으로 본다 — 규칙이 사라지면 `NODE_ENV=production` 이라 Secure 로 떨어진다.
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(
    server,
    /if \(!process\.env\.COOKIE_SECURE\) process\.env\.COOKIE_SECURE = "false";/,
  );
});
