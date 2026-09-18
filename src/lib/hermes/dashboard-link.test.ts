import assert from "node:assert/strict";
import test from "node:test";

import { profileLoginUrl } from "./dashboard-link";

test("프로필 로그인 링크는 대시보드 Keys 화면에 프로필을 실어 보낸다", () => {
  // Hermes 대시보드는 `?profile=` 로 관리 대상 프로필을 고른다(0.21.3 실측: 새로 열어도 noah 가 선택됨).
  assert.equal(
    profileLoginUrl("https://deskrpg-hermes.example.com", "noah"),
    "https://deskrpg-hermes.example.com/env?profile=noah",
  );
});

test("끝 슬래시와 기존 경로를 정리하고 이름을 인코딩한다", () => {
  assert.equal(
    profileLoginUrl("https://h.example.com/", "a_b-1"),
    "https://h.example.com/env?profile=a_b-1",
  );
  assert.equal(
    profileLoginUrl("https://h.example.com/dash/", "x y"),
    "https://h.example.com/dash/env?profile=x%20y",
  );
});

test("주소가 없거나 http(s) 가 아니면 링크를 만들지 않는다", () => {
  assert.equal(profileLoginUrl(null, "noah"), null);
  assert.equal(profileLoginUrl("", "noah"), null);
  assert.equal(profileLoginUrl("javascript:alert(1)", "noah"), null);
  assert.equal(profileLoginUrl("https://h.example.com", ""), null);
});
