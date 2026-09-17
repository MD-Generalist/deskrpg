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

test("DeskRPG 플러그인을 hermes 보다 먼저 설치·활성화한다 — 없으면 게이트웨이 연결이 프로필 목록으로 못 넘어간다", () => {
  assert.match(compose, /^ {2}hermes-plugins:/m);
  assert.match(compose, /hermes plugins install/);
  assert.match(compose, /hermes plugins enable deskrpg/);
  // 이미 설치된 플러그인에 install 을 다시 부르면 exit 1 이다 — 설치 여부를 보고 update 로 갈라야 한다.
  assert.match(compose, /hermes plugins update deskrpg/);
  assert.match(compose, /hermes-plugins:\s*\n\s*condition: service_completed_successfully/);
});

test("플러그인 설치 서비스도 hermes 와 같은 API_SERVER_KEY 를 받는다 — 없으면 이미지가 키를 만들어 볼륨 .env 에 적고, 그 키가 사용자 키를 덮어 DeskRPG 가 401 을 받는다", () => {
  const block = compose.slice(compose.indexOf("  hermes-plugins:"), compose.indexOf("\n  hermes:"));
  assert.match(block, /API_SERVER_KEY: \$\{HERMES_API_KEY:-change-this-hermes-api-key\}/);
  assert.match(block, /HERMES_UID: \$\{HERMES_UID:-10000\}/);
});

test("Hermes 대시보드는 비밀번호가 있을 때만 켠다 — 비어 있으면 인증 게이트가 막아 s6 가 재시작을 반복한다", () => {
  assert.match(compose, /HERMES_DASHBOARD: \$\{HERMES_DASHBOARD_PASSWORD:\+true\}/);
  assert.match(compose, /HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: \$\{HERMES_DASHBOARD_PASSWORD:-\}/);
  assert.match(compose, /loadbalancer\.server\.port=9119/);
});

test("연결기는 deskrpg 와 hermes 둘 다 traefik-proxy 에 붙인다", () => {
  assert.match(compose, /for service in deskrpg hermes/);
});

test(".env.example 에 주석 줄이 없다 — Hostinger 가 그대로 복사해 `# FOO` 를 변수 이름으로 읽는다", () => {
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.deepEqual(
    env.split(/\r?\n/).filter((l) => l.trim().startsWith("#")),
    [],
  );
});
