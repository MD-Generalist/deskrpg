import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// Explicit opt-in: this test sends three or more real agent turns and creates a test task.
// Supply an existing office game path and NPC name. Never use the public landing site.
const enabled = process.env.DESKRPG_E2E_LIVE_WORKFLOW === "1";
const gamePath = process.env.DESKRPG_E2E_GAME_PATH;
const npc = process.env.DESKRPG_E2E_NPC;

test("office work: request, verify registration, review, revise, and acknowledge", async ({
  page,
}, info) => {
  test.skip(!enabled, "Set DESKRPG_E2E_LIVE_WORKFLOW=1 to authorize real agent work");
  test.setTimeout(600_000);
  expect(new URL(String(info.project.use.baseURL)).hostname).toBe("stage.deskrpg.com");
  expect(gamePath).toMatch(/^\/game\?/);
  expect(npc).toBeTruthy();
  const title = `[workflow-check ${Date.now()}] 주간 업무 점검 안내문`;
  const timings: Record<string, number> = {};
  const start = Date.now();
  await login(page);
  await page.goto(gamePath!);
  await page.getByRole("button", { name: `${npc} 대화`, exact: true }).click();
  const panel = page.getByRole("complementary", { name: `${npc} 채팅`, exact: true });
  const chatTab = panel.getByRole("tab", { name: "대화", exact: true });
  const cardsTab = panel.getByRole("tab", { name: /^카드/ });
  const replies = panel.locator('[data-chat-bubble="npc"][data-streaming="false"]');

  async function ask(message: string) {
    await chatTab.click();
    const before = await replies.count();
    await panel.getByRole("textbox").fill(message);
    await panel.getByRole("textbox").press("Enter");
    await expect(replies).toHaveCount(before + 1, { timeout: 150_000 });
    return (await replies.last().innerText()).trim();
  }

  try {
    await ask(
      `${title} — 검증용 업무입니다. 외부 검색·발송·게시 없이 완료한 일, 막힌 일, 다음 주 할 일을 점검하는 한국어 3문장 안내문을 작성해 주세요. 기존 파일과 설정은 변경하지 마세요.`,
    );
    timings.requestMs = Date.now() - start;
    await ask(
      `네. 제목은 ${title} 입니다. 실제 칸반 카드로 등록하고 수행해 주세요. 등록을 표현하는 JSON 텍스트만 출력하지 마세요.`,
    );
    // A conversational claim or json:task fence is not evidence of a persisted task.
    await cardsTab.click();
    await expect(
      panel.getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
    ).toBeVisible();
    timings.registeredMs = Date.now() - start;
    const revised = await ask(
      `${title} 초안을 수정해 주세요. 둘째 문장에는 담당자와 필요한 지원, 셋째 문장에는 마감일을 명시하세요. 수정한 3문장 전체를 답해 주세요.`,
    );
    expect(revised).toContain("담당자");
    expect(revised).toContain("마감일");
    timings.revisedMs = Date.now() - start;
    await ask(
      `${title} 수정 결과를 확인했습니다. 이 검증 업무를 완료 처리하고, 다른 작업은 하지 마세요.`,
    );
    await cardsTab.click();
    const card = panel.getByRole("button").filter({ hasText: title });
    await expect(card).toContainText("완료");
    timings.completedMs = Date.now() - start;
  } finally {
    await info.attach("workflow-timings", {
      body: JSON.stringify({ title, timings }),
      contentType: "application/json",
    });
  }
});
