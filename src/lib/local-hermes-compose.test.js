// docker/docker-compose.hermes.yml 은 VPS 없이 내 컴퓨터에서 DeskRPG + Hermes 를 띄운다.
// 루트 VPS 스택과 달리 HTTP·localhost 전제라, 아래 규칙이 깨지면 로그인이나 게이트웨이 연결이 조용히 실패한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..");
const compose = fs.readFileSync(path.join(ROOT, "docker", "docker-compose.hermes.yml"), "utf8");

test("공개 포트는 전부 127.0.0.1 에만 묶는다 — 같은 네트워크의 남이 사무실·대시보드에 닿지 않게", () => {
  const published = [...compose.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map((m) => m[1]);
  assert.ok(published.length >= 3, `포트 매핑 ${published.length}개`);
  for (const p of published) assert.match(p, /^127\.0\.0\.1:\d+:\d+$/, p);
});

test("사무실과 소켓 포트를 함께 연다 — 소켓 포트가 없으면 화면만 뜨고 실시간 연결이 안 된다", () => {
  assert.match(compose, /"127\.0\.0\.1:3102:3000"/);
  assert.match(compose, /"127\.0\.0\.1:3103:3001"/);
});

test("COOKIE_SECURE 기본값은 false 다 — HTTP 에서 Secure 쿠키는 버려져 로그인이 반복된다", () => {
  assert.match(compose, /COOKIE_SECURE: \$\{COOKIE_SECURE:-false\}/);
});

test("Hermes API 서버는 공개하지 않는다 — DeskRPG 는 compose 내부망의 hermes:8642 로 붙는다", () => {
  assert.doesNotMatch(compose, /:8642"/);
  assert.match(compose, /API_SERVER_PORT: "8642"/);
});

test("플러그인 설치와 게이트웨이가 같은 HERMES_API_KEY 를 받고, 비어 있으면 기동을 거부한다", () => {
  const keys = [...compose.matchAll(/API_SERVER_KEY: (.+)$/gm)].map((m) => m[1].trim());
  assert.equal(keys.length, 2);
  for (const k of keys) assert.match(k, /^\$\{HERMES_API_KEY:\?/);
});

test("플러그인을 게이트웨이보다 먼저 설치·활성화한다", () => {
  assert.match(compose, /hermes plugins enable deskrpg/);
  assert.match(compose, /hermes plugins update deskrpg/);
  assert.match(compose, /hermes-plugins:\s*\n\s*condition: service_completed_successfully/);
});

test("대시보드는 비밀번호가 있을 때만 켠다", () => {
  assert.match(compose, /HERMES_DASHBOARD: \$\{HERMES_DASHBOARD_PASSWORD:\+true\}/);
});

test("Traefik 라벨과 공개 JWT 기본값이 없다", () => {
  assert.doesNotMatch(compose, /traefik\./);
  assert.match(compose, /JWT_SECRET: \$\{JWT_SECRET:-\}/);
});

test("모델 키를 Hermes 볼륨의 .env 에 적는다 — 컨테이너 환경변수만으로는 Hermes 가 키를 읽지 않고, 새 직원도 그 파일에서 키를 물려받는다", () => {
  const block = compose.slice(compose.indexOf("  hermes-plugins:"), compose.indexOf("\n  hermes:"));
  for (const v of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    assert.match(block, new RegExp(`${v}: \\$\\{${v}:-\\}`));
  }
  assert.match(block, /for v in OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY/);
  assert.match(block, /> \/opt\/data\/\.env/);
});
