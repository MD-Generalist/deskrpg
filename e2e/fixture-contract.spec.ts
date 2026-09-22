import { test, expect, installGameFixture, assertFixtureRequests } from "./fixtures/game";

test("알 수 없는 API는 중단되고 메서드·경로를 포함한 실패로 보고된다", async ({
  context,
  page,
  fixtureDiagnostics,
  baseURL,
}) => {
  await installGameFixture(context, {
    channelId: "contract",
    characterId: "contract-character",
    handle: async () => false,
  });
  await page.setContent("<title>Fixture contract probe</title>");
  const result = await page.evaluate(async (origin) => {
    try {
      await fetch(`${origin}/api/fixture-unhandled?probe=1`, { method: "POST" });
      return "unexpected success";
    } catch {
      return "aborted";
    }
  }, baseURL);
  expect(result).toBe("aborted");
  expect(fixtureDiagnostics).toEqual(["POST /api/fixture-unhandled?probe=1"]);
  expect(() => assertFixtureRequests(fixtureDiagnostics)).toThrow(/POST \/api\/fixture-unhandled/);
  // 이 스펙에서 의도한 요청만 소비한다. 다른 API·페이지 오류는 자동 종료 검사가 잡는다.
  fixtureDiagnostics.splice(0, 1);
});
