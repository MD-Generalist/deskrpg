import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSafeHttpUrl, oauthReducer, pollDelayMs } from "./provider-auth-model";

describe("provider-auth-model", () => {
  it("시작 → 대기 → 승인이면 done", () => {
    let s = oauthReducer({ kind: "idle" }, { type: "start" });
    assert.equal(s.kind, "starting");
    s = oauthReducer(s, {
      type: "started",
      sessionId: "s1",
      userCode: "AB-12",
      verificationUrl: "https://x/d",
      expiresIn: 900,
      now: 0,
    });
    assert.deepEqual(s, {
      kind: "waiting",
      sessionId: "s1",
      userCode: "AB-12",
      verificationUrl: "https://x/d",
      expiresAt: 900_000,
    });
    assert.equal(oauthReducer(s, { type: "poll", status: "pending", error: null }).kind, "waiting");
    assert.equal(oauthReducer(s, { type: "poll", status: "approved", error: null }).kind, "done");
  });
  it("거절·만료·오류는 failed 로 사유 코드를 남긴다", () => {
    const w = {
      kind: "waiting" as const,
      sessionId: "s",
      userCode: "c",
      verificationUrl: "https://x",
      expiresAt: 1,
    };
    assert.deepEqual(oauthReducer(w, { type: "poll", status: "denied", error: null }), {
      kind: "failed",
      errorCode: "oauth_denied",
    });
    assert.deepEqual(oauthReducer(w, { type: "poll", status: "expired", error: null }), {
      kind: "failed",
      errorCode: "oauth_expired",
    });
    assert.deepEqual(oauthReducer(w, { type: "poll", status: "error", error: "x" }), {
      kind: "failed",
      errorCode: "oauth_error",
    });
  });
  it("취소하면 idle", () => {
    const w = {
      kind: "waiting" as const,
      sessionId: "s",
      userCode: "c",
      verificationUrl: "https://x",
      expiresAt: 1,
    };
    assert.deepEqual(oauthReducer(w, { type: "cancel" }), { kind: "idle" });
  });
  it("폴링 간격은 최소 2초", () => {
    assert.equal(pollDelayMs(undefined), 2500);
    assert.equal(pollDelayMs(1), 2000);
    assert.equal(pollDelayMs(5), 5000);
  });
  it("http(s) 만 연다", () => {
    assert.equal(isSafeHttpUrl("https://auth.openai.com/codex/device"), true);
    assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
    assert.equal(isSafeHttpUrl("not a url"), false);
  });

  // 브리프 밖 보강 — 뒤늦게 도착한 이벤트가 상태를 되살리지 않는다.
  it("대기가 아닐 때 온 poll·started 는 무시한다", () => {
    const idle = { kind: "idle" as const };
    assert.deepEqual(oauthReducer(idle, { type: "poll", status: "approved", error: null }), idle);
    const started = {
      type: "started" as const,
      sessionId: "s",
      userCode: "c",
      verificationUrl: "https://x",
      expiresIn: 1,
      now: 0,
    };
    assert.deepEqual(oauthReducer(idle, started), idle);
  });
  it("시작·대기 중 실패는 failed, 실패·완료 뒤 start 는 다시 starting", () => {
    assert.deepEqual(oauthReducer({ kind: "starting" }, { type: "fail", errorCode: "forbidden" }), {
      kind: "failed",
      errorCode: "forbidden",
    });
    assert.equal(
      oauthReducer({ kind: "failed", errorCode: "x" }, { type: "start" }).kind,
      "starting",
    );
    assert.equal(oauthReducer({ kind: "done" }, { type: "start" }).kind, "starting");
    assert.equal(oauthReducer({ kind: "starting" }, { type: "start" }).kind, "starting");
  });
  it("폴링 간격 입력이 숫자가 아니면 기본값", () => {
    assert.equal(pollDelayMs(Number.NaN), 2500);
    assert.equal(pollDelayMs(0), 2000);
  });
});
