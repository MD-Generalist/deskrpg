// 쿠키를 `Secure` 로 낼지 정하는 규칙. 이 규칙이 틀리면 **HTTP 배포에서 로그인이 통째로 막힌다** —
// 가입·로그인 API 는 200 인데 브라우저가 쿠키를 버려 `/auth` 에 머문다(2026-09-18 실측:
// Safari 는 localhost 포함 전부, Chrome 은 사설 IP). 증상이 서버 로그에 남지 않아 조용하다.
import assert from "node:assert/strict";
import test from "node:test";

import { isSecureCookie } from "./jwt";

/** `process.env` 를 건드리는 테스트는 반드시 되돌린다 — 다른 파일과 한 프로세스를 쓴다. */
function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("COOKIE_SECURE 가 있으면 NODE_ENV 와 무관하게 그 값이 이긴다", () => {
  withEnv({ COOKIE_SECURE: "false", NODE_ENV: "production" }, () => {
    assert.equal(isSecureCookie(), false, "HTTP 배포에서 Secure 쿠키가 나간다 — 로그인이 막힌다");
  });
  withEnv({ COOKIE_SECURE: "true", NODE_ENV: "development" }, () => {
    assert.equal(isSecureCookie(), true);
  });
});

test("COOKIE_SECURE 가 없으면 production 에서만 Secure 다", () => {
  withEnv({ COOKIE_SECURE: undefined, NODE_ENV: "production" }, () => {
    assert.equal(isSecureCookie(), true);
  });
  withEnv({ COOKIE_SECURE: undefined, NODE_ENV: "development" }, () => {
    assert.equal(isSecureCookie(), false);
  });
});

test("`false`·`true` 가 아닌 값은 설정으로 치지 않는다 — production 기본값으로 떨어진다", () => {
  // `COOKIE_SECURE=0` 을 끄는 뜻으로 쓴 사람이 HTTPS 처럼 동작하는 것을 보고 놀라지 않게,
  // 이 동작을 여기에 적어 둔다. 바꾸려면 이 테스트를 먼저 바꾼다.
  withEnv({ COOKIE_SECURE: "0", NODE_ENV: "production" }, () => {
    assert.equal(isSecureCookie(), true);
  });
});
