import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { SignJWT } from "jose";

const CHANNEL_ID = "kanban-e2e-channel";
const CHARACTER_ID = "kanban-e2e-character";
const TASK_ID = "kanban-e2e-task";
const DEV_JWT_SECRET = "deskrpg-dev-jwt-secret-do-not-use-in-production";
const BASE_URL = process.env.DESKRPG_E2E_BASE_URL ?? "http://localhost:3000";

type TaskStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

type FixtureState = {
  status: TaskStatus;
  boardReads: number;
  patchBodies: unknown[];
  patchMode: "success" | "error" | "pending";
  releasePatch?: () => void;
  deleteAfterPatch?: boolean;
  hidden?: boolean;
};

const statuses: TaskStatus[] = [
  "triage",
  "todo",
  "scheduled",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "archived",
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function board(state: FixtureState, includeArchived: boolean) {
  return {
    columns: statuses
      .filter((status) => includeArchived || status !== "archived")
      .map((status) => ({
        name: status,
        tasks:
          status === state.status && !state.hidden
            ? [{ id: TASK_ID, title: "브라우저 이동 카드", status, assignee: "fixture" }]
            : [],
      })),
    tenants: [],
    assignees: ["fixture"],
    latest_event_id: null,
    now: "2026-09-17T00:00:00Z",
    npcs: [{ npcId: "npc-1", npcName: "Fixture NPC", profileName: "fixture", active: true }],
  };
}

async function installFixture(context: BrowserContext, state: FixtureState) {
  const token = await new SignJWT({ userId: "e2e-user", nickname: "E2E" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(DEV_JWT_SECRET));
  await context.addCookies([
    // 쿠키는 테스트가 실제로 여는 주소에 심는다 — 3000 으로 박아 두면 다른 포트의 서버에서는
    // 로그인이 안 돼 "인증 확인 중" 에서 멈춘다.
    { name: "token", value: token, url: BASE_URL, httpOnly: true, sameSite: "Lax" },
  ]);

  await context.route("**/socket.io/**", (route) => route.abort());
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    // 게임 화면은 "나" 를 URL 이 아니라 여기서 읽는다. 비어 있으면 캐릭터 화면으로 튕긴다.
    if (path === "/api/characters/me") {
      return json(route, {
        character: {
          id: CHARACTER_ID,
          name: "E2E Character",
          appearance: { officeLookId: "office-jun", bodyType: "male" },
        },
      });
    }
    if (path === "/api/characters") {
      return json(route, {
        characters: [
          {
            id: CHARACTER_ID,
            name: "E2E Character",
            appearance: { officeLookId: "office-jun", bodyType: "male" },
          },
        ],
      });
    }
    if (path === `/api/channels/${CHANNEL_ID}`) {
      return json(route, {
        channel: {
          id: CHANNEL_ID,
          name: "Kanban E2E",
          description: null,
          inviteCode: null,
          mapData: null,
          mapConfig: null,
          mapRevision: "fixture",
          isPublic: true,
          isMember: true,
          isOwner: true,
          hasGateway: true,
        },
      });
    }
    if (path === "/api/npcs") return json(route, { npcs: [] });
    if (path === "/api/meetings") return json(route, { minutes: [] });
    if (path.endsWith("/automation/status")) {
      return json(route, {
        pluginStatus: "ready",
        pluginVersion: "0.6.0",
        capabilities: ["kanban", "events"],
        timezone: "Asia/Seoul",
        boardSlug: "fixture",
        dispatcherPresent: true,
        attachments: true,
        lastPolledAt: null,
        lastError: null,
        minVersion: "0.6.0",
        working: [],
      });
    }
    // 카드 상세는 그 카드의 결과물도 읽는다. 목록이 없는 응답이면 드로어가 통째로 죽는다.
    if (path.endsWith("/artifacts"))
      return json(route, { artifacts: [], cursor: "", has_more: false });
    if (path.endsWith("/kanban/board")) {
      state.boardReads += 1;
      return json(route, board(state, url.searchParams.get("include_archived") === "true"));
    }
    if (path.endsWith(`/kanban/tasks/${TASK_ID}`) && request.method() === "GET") {
      return json(route, {
        task: { id: TASK_ID, title: "브라우저 이동 카드", status: state.status },
        comments: [],
        events: [],
        attachments: [],
        links: { parents: [], children: [] },
        runs: [],
      });
    }
    if (path.endsWith(`/kanban/tasks/${TASK_ID}`) && request.method() === "PATCH") {
      const body = request.postDataJSON() as { status: TaskStatus };
      state.patchBodies.push(body);
      if (state.patchMode === "error") {
        return json(route, { code: "fixture_failure", message: "fixture move failed" }, 500);
      }
      if (state.patchMode === "pending") {
        await new Promise<void>((resolve) => (state.releasePatch = resolve));
      }
      state.status = body.status;
      if (state.deleteAfterPatch) state.hidden = true;
      return json(route, {
        task: { id: TASK_ID, title: "브라우저 이동 카드", status: body.status },
      });
    }
    return json(route, {});
  });
}

async function openBoard(page: Page) {
  // 페이지가 죽으면 뒤의 단계는 "요소를 못 찾음" 으로만 보인다 — 원인을 그대로 드러낸다.
  page.on("pageerror", (error) => console.error(`[pageerror] ${error.stack ?? error.message}`));
  await page.goto(`/game?channelId=${CHANNEL_ID}&characterId=${CHARACTER_ID}`);
  await page.getByRole("button", { name: "칸반 보드" }).click();
  await expect(page.getByRole("dialog", { name: "칸반 보드" })).toBeVisible();
  await expect(page.locator(`[data-card-move-handle="${TASK_ID}"]`)).toBeVisible();
}

async function drag(page: Page, target: string | { x: number; y: number }) {
  const handle = page.locator(`[data-card-move-handle="${TASK_ID}"]`);
  const from = await handle.boundingBox();
  expect(from).not.toBeNull();
  const point =
    typeof target === "string"
      ? await page.locator(`[data-column="${target}"]`).boundingBox()
      : { ...target, width: 0, height: 0 };
  expect(point).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(point!.x + point!.width / 2, point!.y + Math.min(80, point!.height / 2), {
    steps: 8,
  });
  return { handle, point: { x: point!.x + point!.width / 2, y: point!.y + 40 } };
}

test("mouse drag highlights an empty column and waits for server truth before moving", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    status: "todo",
    boardReads: 0,
    patchBodies: [],
    patchMode: "pending",
  };
  await installFixture(context, state);
  await openBoard(page);

  const source = page.locator('[data-column="todo"]');
  const target = page.locator('[data-column="scheduled"]');
  const { point } = await drag(page, "scheduled");
  await expect(target).toHaveAttribute("data-move-target", "true");
  await page.mouse.up();

  await expect(page.locator('[data-move-status="pending"]')).toContainText("브라우저 이동 카드");
  await expect(source).toContainText("브라우저 이동 카드");
  await expect(target).not.toContainText("브라우저 이동 카드");
  expect(state.patchBodies).toEqual([{ status: "scheduled" }]);

  state.releasePatch?.();
  await expect(target).toContainText("브라우저 이동 카드");
  await expect(page.locator('[data-move-status="success"]')).toBeVisible();
  await expect(page.locator(`[data-card-move-handle="${TASK_ID}"]`)).toBeFocused();
  expect(state.boardReads).toBeGreaterThanOrEqual(2);
  expect(point.x).toBeGreaterThan(0);
});

test("successful move focuses the board fallback when the authoritative card disappeared", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    status: "todo",
    boardReads: 0,
    patchBodies: [],
    patchMode: "success",
    deleteAfterPatch: true,
  };
  await installFixture(context, state);
  await openBoard(page);
  const handle = page.locator(`[data-card-move-handle="${TASK_ID}"]`);
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowRight");
  await handle.press("Enter");
  await expect(page.locator('[data-move-status="success"]')).toBeVisible();
  await expect(page.locator("[data-kanban-board-root]")).toBeFocused();
  expect(state.patchBodies).toEqual([{ status: "scheduled" }]);
});

test("keyboard movement, detail click, Escape, same-column and outside drops stay separate", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    status: "todo",
    boardReads: 0,
    patchBodies: [],
    patchMode: "success",
  };
  await installFixture(context, state);
  await openBoard(page);

  await page.locator(`[data-card-detail="${TASK_ID}"]`).click();
  await expect(page.locator("#kanban-status")).toHaveValue("todo");
  await page
    .getByRole("complementary", { name: "카드 상세" })
    .getByRole("button", { name: "닫기" })
    .click();
  expect(state.patchBodies).toEqual([]);

  const handle = page.locator(`[data-card-move-handle="${TASK_ID}"]`);
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowRight");
  await expect(page.locator('[data-column="scheduled"]')).toHaveAttribute(
    "data-move-target",
    "true",
  );
  await handle.press("Escape");
  await expect(handle).toBeFocused();
  expect(state.patchBodies).toEqual([]);

  await handle.press("Space");
  await handle.press("ArrowLeft");
  await handle.press("ArrowRight");
  await handle.press("Enter");
  expect(state.patchBodies).toEqual([]);

  const outside = await drag(page, { x: 2, y: 2 });
  await page.mouse.move(outside.point.x, outside.point.y);
  await page.mouse.up();
  expect(state.patchBodies).toEqual([]);

  await handle.press("Space");
  await handle.press("ArrowRight");
  await handle.press("Enter");
  await expect(page.locator('[data-column="scheduled"]')).toContainText("브라우저 이동 카드");
  expect(state.patchBodies).toEqual([{ status: "scheduled" }]);
});

test("horizontal edge scrolling reaches an initially offscreen target and server errors keep source truth", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    status: "todo",
    boardReads: 0,
    patchBodies: [],
    patchMode: "error",
  };
  await installFixture(context, state);
  await openBoard(page);

  const scroller = page.locator(".overflow-x-auto").filter({ has: page.locator("[data-column]") });
  const before = await scroller.evaluate((el) => el.scrollLeft);
  const handle = page.locator(`[data-card-move-handle="${TASK_ID}"]`);
  const box = await handle.boundingBox();
  const bounds = await scroller.boundingBox();
  expect(box).not.toBeNull();
  expect(bounds).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 18; i++) {
    await page.mouse.move(bounds!.x + bounds!.width - 2, box!.y + 40, { steps: 2 });
  }
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  const done = page.locator('[data-column="done"]');
  await done.scrollIntoViewIfNeeded();
  const doneBox = await done.boundingBox();
  await page.mouse.move(doneBox!.x + doneBox!.width / 2, doneBox!.y + 60, { steps: 5 });
  await expect(done).toHaveAttribute("data-move-target", "true");
  await page.mouse.up();

  await expect(page.locator('[data-move-status="error"]')).toContainText("fixture move failed");
  await expect(page.locator('[data-column="todo"]')).toContainText("브라우저 이동 카드");
  expect(state.patchBodies).toEqual([{ status: "done" }]);
});

test("archived filtering and fixed column order remain intact", async ({ context, page }) => {
  const state: FixtureState = {
    status: "todo",
    boardReads: 0,
    patchBodies: [],
    patchMode: "success",
  };
  await installFixture(context, state);
  await openBoard(page);
  await expect(page.locator("[data-column]")).toHaveCount(8);
  expect(
    await page
      .locator("[data-column]")
      .evaluateAll((columns) => columns.map((column) => column.getAttribute("data-column"))),
  ).toEqual(["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"]);
  await page.getByLabel("보관함 보기").check();
  await expect(page.locator('[data-column="archived"]')).toBeVisible();
});

test.describe("touch emulation", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("an emulated touch-pointer sequence drops onto an empty column", async ({
    context,
    page,
  }) => {
    const state: FixtureState = {
      status: "todo",
      boardReads: 0,
      patchBodies: [],
      patchMode: "success",
    };
    await installFixture(context, state);
    await openBoard(page);
    await page
      .locator(".overflow-x-auto")
      .filter({ has: page.locator("[data-column]") })
      .evaluate((element) => element.scrollTo({ left: 260 }));
    const handleLocator = page.locator(`[data-card-move-handle="${TASK_ID}"]`);
    const handle = await handleLocator.boundingBox();
    const target = await page.locator('[data-column="scheduled"]').boundingBox();
    expect(handle).not.toBeNull();
    expect(target).not.toBeNull();
    const start = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
    const end = { x: target!.x + target!.width / 2, y: target!.y + 60 };
    await handleLocator.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
    });
    for (let step = 1; step <= 6; step++) {
      await handleLocator.dispatchEvent("pointermove", {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: -1,
        buttons: 1,
        clientX: start.x + ((end.x - start.x) * step) / 6,
        clientY: start.y + ((end.y - start.y) * step) / 6,
      });
    }
    await expect(page.locator('[data-column="scheduled"]')).toHaveAttribute(
      "data-move-target",
      "true",
    );
    await handleLocator.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: end.x,
      clientY: end.y,
    });
    await expect(page.locator('[data-column="scheduled"]')).toContainText("브라우저 이동 카드");
    expect(state.patchBodies).toEqual([{ status: "scheduled" }]);
  });
});
