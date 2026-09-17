// 루트 docker-compose.yml 은 Hostinger 도커 매니저가 그대로 배포한다. 아래 규칙은 전부 실측에서 나왔고,
// 하나라도 깨지면 원클릭 배포가 조용히 실패한다(근거: deploy/hostinger/README.md).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");

test("8192자 이하다 — 도커 매니저 API 가 더 긴 content 를 거부한다", () => {
  assert.ok(compose.length <= 8192, `현재 ${compose.length}자`);
});

test("traefik-proxy 를 네트워크로 선언하지 않는다 — external 은 호스트 모드, 생성은 브리지 모드 Traefik 을 깨뜨린다", () => {
  assert.doesNotMatch(compose, /^networks:/m);
  assert.doesNotMatch(compose, /^\s+-\s*traefik-proxy\s*$/m);
});

test("브리지 모드 Traefik 이 쓸 네트워크를 라벨로 지정하고, 연결기가 런타임에 붙인다", () => {
  assert.match(compose, /traefik\.docker\.network=traefik-proxy/);
  assert.match(compose, /^ {2}traefik-connect:/m);
  assert.match(compose, /docker network connect traefik-proxy/);
  // 연결기는 자기 프로젝트 라벨로 대상을 찾는다 — 프로젝트 이름이 deskrpg 가 아니어도 동작해야 한다.
  assert.match(compose, /com\.docker\.compose\.project/);
});

test("DeskRPG 이미지 기본값은 :latest 다 — 도커 매니저의 업데이트는 저장된 compose 로 이미지만 다시 받는다", () => {
  // 버전을 고정하면 업데이트를 눌러도 같은 버전을 다시 받을 뿐 새 릴리스로 올라가지 않는다.
  // 특정 버전에 머물거나 되돌리려면 DESKRPG_IMAGE 환경변수로 덮는다.
  assert.match(compose, /image: \$\{DESKRPG_IMAGE:-ghcr\.io\/dandacompany\/deskrpg:latest\}/);
});

test(".env.example 에 주석 줄이 없다 — Hostinger 가 그대로 복사해 `# FOO` 를 변수 이름으로 읽는다", () => {
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.deepEqual(
    env.split(/\r?\n/).filter((l) => l.trim().startsWith("#")),
    [],
  );
});
