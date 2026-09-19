import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../lib/i18n/context";
import ProviderAuthPanel, { type ProviderAuthPanelProps } from "./ProviderAuthPanel";

const BASE = "/api/gateways/g/plugin/profiles/noah";
const SECRET = "sk-test-SEEDED-secret-value-123456";

type Reply = { status?: number; body: unknown };
type Call = { method: string; url: string; body: string | null };

/**
 * `METHOD URL`(정확히 일치) → 응답. 값이 배열이면 호출마다 하나씩 꺼내고 마지막을 유지한다.
 * 진짜 `Response` 대신 최소 객체를 돌려준다 — 가짜 타이머를 켠 동안 본문 읽기가 내부
 * 타이머에 기대지 않게.
 */
function stubFetch(routes: Record<string, Reply | Reply[]>) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  const cursors: Record<string, number> = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${String(url)}`;
    calls.push({
      method,
      url: String(url),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const entry = routes[key];
    if (!entry) throw new Error(`unexpected fetch: ${key}`);
    let reply: Reply;
    if (Array.isArray(entry)) {
      const i = cursors[key] ?? 0;
      reply = entry[Math.min(i, entry.length - 1)];
      cursors[key] = i + 1;
    } else {
      reply = entry;
    }
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => reply.body,
    } as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    count: (method: string, url: string) =>
      calls.filter((c) => c.method === method && c.url === url).length,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** console 로 흘러간 모든 문자열을 모은다 — 비밀 값이 없어야 한다. */
function captureConsole() {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of ["log", "warn", "error", "info"] as const) {
    console[k] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
  return {
    lines,
    restore: () => Object.assign(console, saved),
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

type Provider = ProviderAuthPanelProps["provider"];

async function mount(provider: Provider, extra: Partial<ProviderAuthPanelProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let authenticated = 0;
  const render = (p: Provider, e: Partial<ProviderAuthPanelProps>) =>
    root.render(
      <I18nProvider initialLocale="ko">
        <ProviderAuthPanel
          profileBase={BASE}
          provider={p}
          onAuthenticated={() => {
            authenticated += 1;
          }}
          {...e}
        />
      </I18nProvider>,
    );
  await act(async () => render(provider, extra));
  await flush();
  return {
    host,
    authenticated: () => authenticated,
    rerender: async (p: Provider, e: Partial<ProviderAuthPanelProps> = {}) => {
      await act(async () => render(p, e));
      await flush();
    },
    unmount: () => act(async () => root.unmount()),
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  assert.ok(found, `button "${label}" not found in: ${host.textContent}`);
  return found;
}

function hasButton(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.trim() === label);
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}

/** React 제어 입력에 값을 넣는다 — value setter 를 거쳐 input 이벤트를 낸다. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const OPENAI_KEY: Provider = {
  id: "openai",
  name: "OpenAI",
  authenticated: false,
  authType: "api_key",
  envVars: ["OPENAI_API_KEY"],
};
const CODEX: Provider = {
  id: "openai-codex",
  name: "OpenAI Codex",
  authenticated: false,
  authType: "oauth_device",
};
const START = {
  sessionId: "sess-1",
  userCode: "ABCD-1234",
  verificationUrl: "https://auth.openai.com/codex/device",
  expiresIn: 900,
  pollInterval: 1,
};
const PENDING = {
  status: "pending",
  error: null,
  expiresAt: null,
  retryable: null,
  retryAfter: null,
};
const APPROVED = { ...PENDING, status: "approved" };

test("api_key: 비밀번호 입력으로 키를 저장하고 값을 어디에도 되돌려 보여 주지 않는다", async () => {
  const f = stubFetch({
    [`PUT ${BASE}/provider-keys/openai`]: {
      body: { configured: true, envVar: "OPENAI_API_KEY" },
    },
  });
  const con = captureConsole();
  const view = await mount(OPENAI_KEY);
  try {
    const input = view.host.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.getAttribute("type"), "password");
    // 비밀번호 관리자가 이 칸을 로그인으로 보지 않게 한다(2026-09-19 스테이징 실측: Bitwarden 이
    // "기존 로그인 업데이트" 를 띄웠다). "off" 는 password 입력에서 무시된다.
    assert.equal(input.getAttribute("autocomplete"), "new-password");
    assert.equal(input.getAttribute("data-bwignore"), "true");
    await typeInto(input, SECRET);
    await click(button(view.host, "키 저장"));

    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, "PUT");
    assert.equal(f.calls[0].url, `${BASE}/provider-keys/openai`);
    assert.deepEqual(JSON.parse(f.calls[0].body!), { value: SECRET });
    assert.equal(view.host.querySelector<HTMLInputElement>("input")?.value ?? "", "");
    assert.equal(view.authenticated(), 1);
    assert.ok(!view.host.innerHTML.includes(SECRET));
    assert.ok(!con.lines.some((l) => l.includes(SECRET)));
  } finally {
    await view.unmount();
    con.restore();
    f.restore();
  }
});

test("api_key: 빈 값이면 저장 버튼이 꺼져 있다", async () => {
  const f = stubFetch({});
  const view = await mount(OPENAI_KEY);
  try {
    assert.equal(button(view.host, "키 저장").disabled, true);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("oauth_device: 로그인 → 코드·링크 → 승인되면 onAuthenticated 1회", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: [{ body: PENDING }, { body: APPROVED }],
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    assert.equal(f.count("POST", `${BASE}/oauth/openai-codex/start`), 1);
    assert.ok(view.host.textContent?.includes("ABCD-1234"));
    const link = view.host.querySelector<HTMLAnchorElement>("a")!;
    assert.equal(link.textContent?.trim(), "인증 페이지 열기");
    assert.equal(link.getAttribute("href"), START.verificationUrl);
    assert.equal(link.getAttribute("target"), "_blank");
    const rel = link.getAttribute("rel") ?? "";
    assert.ok(rel.includes("noopener") && rel.includes("noreferrer"));

    // 폴링은 pollDelayMs 뒤에 한 번씩 — 겹치지 않는다.
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 0);
    await act(async () => t.mock.timers.tick(1999));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 0);
    await act(async () => t.mock.timers.tick(1));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 1);
    assert.equal(view.authenticated(), 0);
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 2);
    assert.equal(view.authenticated(), 1);

    // 승인 뒤로는 더 폴링하지 않고, 끝난 세션을 지우지도 않는다.
    await act(async () => t.mock.timers.tick(10_000));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 2);
  } finally {
    await view.unmount();
    f.restore();
  }
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 0);
});

test("oauth_device: 응답이 늦어도 다음 폴링을 겹쳐 보내지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release: (() => void) | null = null;
  const f = stubFetch({ [`POST ${BASE}/oauth/openai-codex/start`]: { body: START } });
  const inner = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/sessions/sess-1") && (init?.method ?? "GET") === "GET") {
      polls += 1;
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: true, status: 200, json: async () => PENDING } as unknown as Response;
    }
    return inner(url, init);
  }) as typeof fetch;
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.equal(polls, 1);
    await act(async () => t.mock.timers.tick(20_000));
    await flush();
    assert.equal(polls, 1, "응답 전에는 다음 폴링을 예약하지 않는다");
    await act(async () => release!());
    await flush();
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.equal(polls, 2);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("oauth_device: 대기 중 언마운트하면 세션 DELETE 1회, 이후 폴링 없음", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: { body: PENDING },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 1);
  } finally {
    await view.unmount();
  }
  await flush();
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
  await act(async () => t.mock.timers.tick(60_000));
  await flush();
  assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 1);
  f.restore();
});

test("oauth_device: 취소 버튼은 세션 DELETE 1회 후 로그인 버튼으로 돌아간다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: { body: PENDING },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    await click(button(view.host, "취소"));
    assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
    assert.ok(hasButton(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(60_000));
    await flush();
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 0);
  } finally {
    await view.unmount();
  }
  // 이미 취소한 세션을 언마운트가 다시 지우지 않는다.
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
  f.restore();
});

test("oauth_device: 거절되면 사유와 다시 시도 버튼", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: { body: { ...PENDING, status: "denied" } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.ok(view.host.textContent?.includes("로그인이 거절됐습니다."));
    assert.ok(hasButton(view.host, "다시 시도"));
    assert.equal(view.authenticated(), 0);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("oauth_device: http(s) 가 아닌 인증 주소는 링크로 싣지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: {
      body: { ...START, verificationUrl: "javascript:alert(1)" },
    },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: { body: PENDING },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    assert.equal(view.host.querySelector("a"), null);
    assert.ok(!view.host.innerHTML.includes("javascript:"));
    assert.ok(view.host.textContent?.includes("ABCD-1234"));
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("external: 명령과 복사 버튼만, 입력·로그인 버튼은 없다", async () => {
  const f = stubFetch({});
  const nav = navigator as unknown as Record<string, unknown>;
  const savedClipboard = Object.getOwnPropertyDescriptor(nav, "clipboard");
  Object.defineProperty(nav, "clipboard", {
    value: { writeText: async () => {} },
    configurable: true,
  });
  const view = await mount({
    id: "copilot",
    name: "Copilot",
    authenticated: false,
    authType: "external",
    cliCommand: "hermes auth add copilot",
  });
  try {
    assert.ok(view.host.textContent?.includes("hermes auth add copilot"));
    assert.ok(view.host.textContent?.includes("게이트웨이 서버에서 이 명령으로 로그인하세요"));
    assert.ok(hasButton(view.host, "복사"));
    assert.equal(view.host.querySelectorAll("input").length, 0);
    assert.ok(!hasButton(view.host, "로그인"));
    assert.equal(f.calls.length, 0);
  } finally {
    await view.unmount();
    if (savedClipboard) Object.defineProperty(nav, "clipboard", savedClipboard);
    else delete nav.clipboard;
    f.restore();
  }
});

test("authType 이 없으면 아무것도 그리지 않는다", async () => {
  const f = stubFetch({});
  const view = await mount({ id: "x", name: "X", authenticated: false });
  try {
    assert.equal(view.host.innerHTML, "");
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("인증된 oauth_device: 연결됨 + 연결 끊기 → DELETE 후 onAuthenticated", async () => {
  const f = stubFetch({ [`DELETE ${BASE}/oauth/openai-codex`]: { body: { ok: true } } });
  const view = await mount({ ...CODEX, authenticated: true });
  try {
    assert.ok(view.host.textContent?.includes("연결됨"));
    assert.ok(!hasButton(view.host, "로그인"));
    await click(button(view.host, "연결 끊기"));
    assert.equal(f.count("DELETE", `${BASE}/oauth/openai-codex`), 1);
    assert.equal(view.authenticated(), 1);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("연결 끊기가 ok:false(지운 것 없음)면 다시 불러오되 끊겼다고 덮어쓰지 않는다", async () => {
  // 플러그인은 그 프로필 auth.json 에 지울 것이 없으면 ok:false 다 — 인증은 환경변수·풀에서 올 수 있다.
  const f = stubFetch({ [`DELETE ${BASE}/oauth/openai-codex`]: { body: { ok: false } } });
  const view = await mount({ ...CODEX, authenticated: true });
  try {
    await click(button(view.host, "연결 끊기"));
    assert.equal(f.count("DELETE", `${BASE}/oauth/openai-codex`), 1);
    assert.equal(view.authenticated(), 1);
    assert.ok(view.host.textContent?.includes("연결됨"));
    assert.ok(hasButton(view.host, "연결 끊기"));
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("인증된 api_key: 연결됨 + 키 교체(입력란) + 키 삭제", async () => {
  const f = stubFetch({
    [`DELETE ${BASE}/provider-keys/openai`]: {
      body: { configured: false, removed: ["OPENAI_API_KEY"] },
    },
  });
  const view = await mount({ ...OPENAI_KEY, authenticated: true });
  try {
    assert.ok(view.host.textContent?.includes("연결됨"));
    assert.equal(view.host.querySelectorAll("input").length, 0);
    await click(button(view.host, "키 교체"));
    const input = view.host.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.getAttribute("type"), "password");
    assert.ok(hasButton(view.host, "키 저장"));

    await click(button(view.host, "키 삭제"));
    assert.equal(f.count("DELETE", `${BASE}/provider-keys/openai`), 1);
    assert.equal(view.authenticated(), 1);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("업스트림 실패는 현지화 메시지로, 값·토큰은 보이지 않는다", async () => {
  const f = stubFetch({
    [`PUT ${BASE}/provider-keys/openai`]: {
      status: 403,
      body: { errorCode: "forbidden", error: `nope ${SECRET}` },
    },
    [`POST ${BASE}/oauth/openai-codex/start`]: {
      body: {
        errorCode: "oauth_flow_unsupported",
        error: "raw upstream text",
        upstreamStatus: 400,
      },
    },
  });
  const con = captureConsole();
  const keyView = await mount(OPENAI_KEY);
  const oauthView = await mount(CODEX);
  try {
    await typeInto(keyView.host.querySelector<HTMLInputElement>("input")!, SECRET);
    await click(button(keyView.host, "키 저장"));
    assert.ok(keyView.host.textContent?.includes("이 작업을 수행할 권한이 없습니다"));
    assert.ok(!keyView.host.textContent?.includes(SECRET));
    assert.ok(!keyView.host.innerHTML.includes(SECRET));
    assert.equal(keyView.authenticated(), 0);

    await click(button(oauthView.host, "로그인"));
    assert.ok(
      oauthView.host.textContent?.includes("이 제공자는 앱 안 로그인을 지원하지 않습니다."),
    );
    assert.ok(!oauthView.host.textContent?.includes("raw upstream text"));
    assert.ok(hasButton(oauthView.host, "다시 시도"));
    assert.ok(!con.lines.some((l) => l.includes(SECRET)));
  } finally {
    await keyView.unmount();
    await oauthView.unmount();
    con.restore();
    f.restore();
  }
});

test("disabled 면 모든 버튼이 꺼진다", async () => {
  const f = stubFetch({});
  const view = await mount({ ...CODEX, authenticated: true }, { disabled: true });
  try {
    assert.equal(button(view.host, "연결 끊기").disabled, true);
  } finally {
    await view.unmount();
    f.restore();
  }
});

// ── 수정 라운드 1 ────────────────────────────────────────────────────────────

test("프로바이더가 바뀌면 입력하던 키를 버린다 — 새 엔드포인트로 새지 않는다", async () => {
  const f = stubFetch({});
  const view = await mount(OPENAI_KEY);
  try {
    await typeInto(view.host.querySelector<HTMLInputElement>("input")!, SECRET);
    await view.rerender({ ...OPENAI_KEY, id: "anthropic", name: "Anthropic" });
    const input = view.host.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.value, "");
    assert.equal(button(view.host, "키 저장").disabled, true);
    assert.equal(f.calls.length, 0);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("대기 중 프로바이더가 바뀌면 옛 세션을 한 번 지우고 idle 로 돌아가며 옛 경로를 폴링하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: { body: PENDING },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    assert.ok(view.host.textContent?.includes("ABCD-1234"));
    await view.rerender({ ...CODEX, id: "nous", name: "Nous" });
    assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
    assert.ok(!view.host.textContent?.includes("ABCD-1234"));
    assert.ok(hasButton(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(60_000));
    await flush();
    assert.equal(f.calls.filter((c) => c.method === "GET").length, 0);
  } finally {
    await view.unmount();
  }
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
  f.restore();
});

test("연결됨 표시는 새 프로바이더의 authenticated 만 따른다", async () => {
  const f = stubFetch({
    [`PUT ${BASE}/provider-keys/openai`]: { body: { configured: true, envVar: "OPENAI_API_KEY" } },
  });
  const view = await mount(OPENAI_KEY);
  try {
    await typeInto(view.host.querySelector<HTMLInputElement>("input")!, SECRET);
    await click(button(view.host, "키 저장"));
    assert.ok(view.host.textContent?.includes("연결됨"));
    await view.rerender({ ...OPENAI_KEY, id: "anthropic", name: "Anthropic" });
    assert.ok(!view.host.textContent?.includes("연결됨"));
    await view.rerender({ ...OPENAI_KEY, id: "mistral", name: "Mistral", authenticated: true });
    assert.ok(view.host.textContent?.includes("연결됨"));
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("폴링 중 프록시의 일시 오류(timeout·unreachable·upstream_error)는 로그인을 끝내지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: [
      { body: { errorCode: "timeout", upstreamStatus: null } },
      { body: { errorCode: "unreachable" } },
      { body: { errorCode: "upstream_error", upstreamStatus: 502 } },
      { body: APPROVED },
    ],
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    for (let i = 0; i < 4; i += 1) {
      await act(async () => t.mock.timers.tick(2000));
      await flush();
    }
    assert.equal(f.count("GET", `${BASE}/oauth/openai-codex/sessions/sess-1`), 4);
    assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 0);
    assert.equal(view.authenticated(), 1);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("폴링 중 다른 errorCode 는 로그인을 끝내고 세션을 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: START },
    [`GET ${BASE}/oauth/openai-codex/sessions/sess-1`]: {
      body: { errorCode: "oauth_session_mismatch" },
    },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    await act(async () => t.mock.timers.tick(2000));
    await flush();
    assert.ok(hasButton(view.host, "다시 시도"));
    assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
  } finally {
    await view.unmount();
    f.restore();
  }
});

test("start 응답이 언마운트 뒤에 와도 그 세션을 한 번 지운다", async () => {
  const f = stubFetch({ [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } } });
  const inner = globalThis.fetch;
  let release: (() => void) | null = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/oauth/openai-codex/start")) {
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: true, status: 200, json: async () => START } as unknown as Response;
    }
    return inner(url, init);
  }) as typeof fetch;
  const view = await mount(CODEX);
  await click(button(view.host, "로그인"));
  await view.unmount();
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 0);
  await act(async () => release!());
  await flush();
  assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
  f.restore();
});

test("네트워크 실패가 이어지면 만료 + 여유 시간 뒤에 폴링을 멈춘다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const f = stubFetch({
    [`POST ${BASE}/oauth/openai-codex/start`]: { body: { ...START, expiresIn: 4 } },
    [`DELETE ${BASE}/oauth/sessions/sess-1`]: { body: { ok: true } },
  });
  const inner = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/sessions/sess-1") && (init?.method ?? "GET") === "GET") {
      polls += 1;
      throw new TypeError("network down");
    }
    return inner(url, init);
  }) as typeof fetch;
  const view = await mount(CODEX);
  try {
    await click(button(view.host, "로그인"));
    // 만료 4초 + 여유 30초 = 34초. 넉넉히 60초를 2초씩 당긴다.
    for (let i = 0; i < 30; i += 1) {
      await act(async () => t.mock.timers.tick(2000));
      await flush();
    }
    const stoppedAt = polls;
    assert.ok(stoppedAt >= 16 && stoppedAt <= 18, `polls=${stoppedAt}`);
    assert.ok(view.host.textContent?.includes("코드가 만료됐습니다. 다시 시도하세요."));
    assert.equal(f.count("DELETE", `${BASE}/oauth/sessions/sess-1`), 1);
    await act(async () => t.mock.timers.tick(60_000));
    await flush();
    assert.equal(polls, stoppedAt);
  } finally {
    await view.unmount();
    f.restore();
  }
});
