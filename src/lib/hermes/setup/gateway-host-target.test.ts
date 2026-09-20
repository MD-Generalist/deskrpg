import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyGatewayHost } from "./gateway-host-target";

test("루프백 주소는 이 서버의 호스트다", () => {
  assert.deepEqual(classifyGatewayHost("http://127.0.0.1:8642"), { mode: "local", port: 8642 });
  assert.deepEqual(classifyGatewayHost("http://localhost:8642/"), { mode: "local", port: 8642 });
});

test("SSH 로 등록된 주소는 호스트 id 를 되찾아야 한다 — 여기서는 ssh 로만 가른다", () => {
  const url = `http://${"a".repeat(64)}.deskrpg-ssh.invalid`;
  assert.deepEqual(classifyGatewayHost(url), { mode: "ssh" });
});

test("그 밖의 주소는 우리가 다룰 수 있는 호스트가 아니다", () => {
  // 컨테이너 배포에서 흔한 주소다 — Hermes 는 호스트에 있고 우리는 그 호스트를 실행할 수 없다.
  assert.deepEqual(classifyGatewayHost("http://host.docker.internal:8642"), {
    mode: "unsupported",
  });
  assert.deepEqual(classifyGatewayHost("https://hermes.example.com"), { mode: "unsupported" });
  assert.deepEqual(classifyGatewayHost("not a url"), { mode: "unsupported" });
});

test("포트가 없으면 로컬로 보지 않는다 — 게이트웨이는 언제나 포트를 가진다", () => {
  assert.deepEqual(classifyGatewayHost("http://127.0.0.1"), { mode: "unsupported" });
});
