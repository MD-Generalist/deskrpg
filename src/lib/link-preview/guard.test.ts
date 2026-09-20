import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isBlockedAddress,
  isSafeImageType,
  normalizePreviewUrl,
  parsePreviewTarget,
} from "./guard";

test("사설·루프백·링크로컬·CGNAT 주소는 막는다", () => {
  for (const ip of [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254", // 클라우드 메타데이터 — 이것을 막는 것이 이 가드의 존재 이유다
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, `막아야 한다: ${ip}`);
  }
});

test("공인 주소는 통과한다", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) {
    assert.equal(isBlockedAddress(ip), false, `통과해야 한다: ${ip}`);
  }
});

test("http(s) 가 아닌 주소는 거부한다", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)"]) {
    assert.equal(parsePreviewTarget(url), null, url);
  }
});

test("자격증명이 박힌 주소는 거부한다 — 프록시가 남의 인증을 대신 들고 가지 않는다", () => {
  assert.equal(parsePreviewTarget("https://user:pw@example.com/"), null);
});

test("표준 포트가 아니면 거부한다 — 내부망 포트 스캔 통로가 된다", () => {
  assert.equal(parsePreviewTarget("https://example.com:8080/"), null);
  assert.ok(parsePreviewTarget("https://example.com:443/"));
  assert.ok(parsePreviewTarget("http://example.com:80/"));
});

test("호스트가 이미 사설 IP 리터럴이면 DNS 를 보지 않고 거부한다", () => {
  assert.equal(parsePreviewTarget("http://169.254.169.254/latest/meta-data/"), null);
  assert.equal(parsePreviewTarget("http://[::1]/"), null);
  assert.equal(parsePreviewTarget("http://localhost/"), null);
});

test("정상 주소는 해시를 떼고 정규화해 돌려준다", () => {
  const url = parsePreviewTarget("https://Example.com/a/b?q=1#frag");
  assert.equal(url?.toString(), "https://example.com/a/b?q=1");
});

test("정규화는 모양만 본다 — 사설 주소도 모양이 맞으면 통과시킨다(주소 판정은 요청 직전에 한다)", () => {
  assert.ok(normalizePreviewUrl("http://127.0.0.1/p"));
  assert.equal(normalizePreviewUrl("file:///etc/passwd"), null);
  assert.equal(normalizePreviewUrl("https://a:b@example.com/"), null);
  // 포트는 모양이 아니라 목적지 판정이다 — parsePreviewTarget 이 막는다.
  assert.ok(normalizePreviewUrl("https://example.com:8080/"));
  assert.equal(parsePreviewTarget("https://example.com:8080/"), null);
});

test("프록시가 되돌려 줄 수 있는 이미지 타입은 래스터뿐이다 — svg 는 스크립트를 품는다", () => {
  for (const ok of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
    assert.equal(isSafeImageType(ok), true, ok);
  }
  for (const bad of [
    "image/svg+xml",
    "image/svg+xml; charset=utf-8",
    "text/html",
    "application/xml",
    "",
  ]) {
    assert.equal(isSafeImageType(bad), false, bad);
  }
});

// dev1 이 `a3c93fd7` 에서 실측한 우회(2026-09-20). URL 파서가 `[::ffff:127.0.0.1]` 을 16진
// 표기 `[::ffff:7f00:1]` 로 정규화해, 표기를 정규식으로 보던 판정이 전부 통과했다.
// 리눅스 듀얼스택 소켓은 `::ffff:a.b.c.d` 연결을 IPv4 `a.b.c.d` 로 보낸다.
test("URL 파서가 정규화한 IPv4-mapped IPv6 로는 내부망에 닿을 수 없다", () => {
  for (const raw of [
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::127.0.0.1]/",
    "http://[64:ff9b::127.0.0.1]/",
    "http://[2002:7f00:1::]/",
  ]) {
    assert.equal(parsePreviewTarget(raw), null, `${raw} → ${new URL(raw).hostname}`);
  }
});

test("정규화된 16진 표기 자체도 막는다 — DNS·리다이렉트가 이 형태로 돌려줄 수 있다", () => {
  for (const address of [
    "::ffff:7f00:1", // 127.0.0.1
    "::ffff:a9fe:a9fe", // 169.254.169.254
    "::ffff:a00:1", // 10.0.0.1
    "::ffff:c0a8:1", // 192.168.0.1
    "64:ff9b::7f00:1", // NAT64 로 감싼 루프백
    "2002:a00:1::", // 6to4 로 감싼 10.0.0.1
    "::1",
    "fe80::1",
    "fc00::1",
    "fe80::1%en0", // 스코프 식별자가 붙어도
    "2001:db8::1", // 문서용
    "2001::1", // Teredo
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("글로벌 유니캐스트만 통과한다 — IPv6 는 허용 목록으로 판정한다", () => {
  for (const address of ["2606:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
  // 2000::/3 밖은 정체를 몰라도 막는다.
  for (const address of ["3ffe::1", "0100::1", "ff02::1"]) {
    assert.equal(isBlockedAddress(address), address !== "3ffe::1", address);
  }
});

test("IP 가 아닌 문자열은 막는다 — 모르는 것을 통과시키지 않는다", () => {
  for (const junk of ["example.com", "", "::ffff:999.1.1.1", "1:2:3", "not-an-ip"]) {
    assert.equal(isBlockedAddress(junk), true, JSON.stringify(junk));
  }
});
