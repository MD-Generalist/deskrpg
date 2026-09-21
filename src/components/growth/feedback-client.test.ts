import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGithubIssueUrl,
  collectAttachments,
  fetchSurvey,
  FALLBACK_SURVEY,
  getInstallId,
  recentErrorDigest,
  recordClientError,
  resolveFeedbackUrl,
} from "./feedback-client";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

test("설치 ID 는 한 번 만들고 계속 같은 값을 쓴다", () => {
  const s = memoryStorage();
  const id = getInstallId(s);
  assert.match(id ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(getInstallId(s), id);
  assert.equal(getInstallId(null), null);
});

test("수집 서버 주소: 없으면 기본값, 빈 값이면 끔", () => {
  assert.equal(resolveFeedbackUrl(undefined), "https://feedback.deskrpg.com");
  assert.equal(resolveFeedbackUrl(""), null);
  assert.equal(resolveFeedbackUrl("  "), null);
  assert.equal(resolveFeedbackUrl("https://example.test/"), "https://example.test");
});

test("최근 오류는 마지막 5건만, 한 줄로 잘라 남긴다", () => {
  for (let i = 0; i < 7; i++) recordClientError(`boom ${i}\nstack line`);
  const digest = recentErrorDigest();
  assert.equal(digest.split("\n").length, 5);
  assert.ok(digest.startsWith("boom 2"));
  assert.ok(!digest.includes("stack line"));
});

test("GitHub 이슈 주소에는 사용자가 남긴 첨부만 들어간다", () => {
  const attachments = collectAttachments({
    version: "2026.921.3",
    userAgent: "UA/1",
    viewport: "1440x900",
    errorDigest: "",
  });
  assert.deepEqual(
    attachments.map((a) => a.key),
    ["version", "userAgent", "viewport"],
  );
  const url = new URL(
    buildGithubIssueUrl({
      title: "맵 멈춤",
      body: "회의 뒤",
      repro: "1. 회의",
      attachments: attachments.filter((a) => a.key !== "userAgent"),
    }),
  );
  assert.equal(url.searchParams.get("title"), "맵 멈춤");
  const body = url.searchParams.get("body") ?? "";
  assert.ok(body.includes("회의 뒤") && body.includes("1. 회의") && body.includes("2026.921.3"));
  assert.ok(!body.includes("UA/1"));
  assert.equal(url.searchParams.get("labels"), "bug-report");
});

test("설문을 서버에서 못 받으면 내장 기본 설문을 쓴다", async () => {
  const failing = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await fetchSurvey("https://x.test", failing as typeof fetch), FALLBACK_SURVEY);
  const ok = async () =>
    new Response(
      JSON.stringify({
        version: 2,
        intervalDays: 14,
        questions: [{ id: "a", type: "nps", prompt: { ko: "?" } }],
      }),
    );
  assert.equal((await fetchSurvey("https://x.test", ok as typeof fetch)).version, 2);
  const junk = async () => new Response(JSON.stringify({ version: "x" }));
  assert.deepEqual(await fetchSurvey("https://x.test", junk as typeof fetch), FALLBACK_SURVEY);
});
