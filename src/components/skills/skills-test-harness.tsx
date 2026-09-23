/**
 * 스킬 화면 테스트의 공용 틀 — `ArtifactsModal.test.tsx` 의 `mockFetch`·`render`·`flush` 와 같은 방식.
 * 테스트 파일이 아니므로 `npm run test` 가 따로 돌리지 않는다.
 */
import "../../test-setup/dom";
import assert from "node:assert/strict";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { SkillRow } from "@/lib/hermes/plugin-client-types";
import { I18nProvider } from "@/lib/i18n/context";

export const ROOT = "/api/channels/ch-1/npcs/n-1/skills";
export const LIST = `GET ${ROOT}/`;

export const row = (name: string, over: Partial<SkillRow> = {}): SkillRow => ({
  name,
  category: "",
  description: "",
  disabled: false,
  essential: false,
  source: "local",
  useCount: 0,
  viewCount: 0,
  ...over,
});

type Reply = Record<string, unknown>;
export type FetchLog = { calls: string[]; bodies: Record<string, unknown> };

/**
 * `"METHOD path"` → 응답. `{status, json}` 은 그 상태로, 나머지는 JSON 200. 모르는 경로는 404.
 * `delayMs` 가 있으면 그만큼 늦게 답한다(본문에는 싣지 않는다). `routes` 는 참조로 읽으므로 테스트 중에 바꿀 수 있다.
 */
export function mockFetch(routes: Record<string, Reply>): FetchLog {
  const log: FetchLog = { calls: [], bodies: {} };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    log.calls.push(key);
    if (typeof init?.body === "string") log.bodies[key] = JSON.parse(init.body);
    const found = routes[key];
    if (found && typeof found.delayMs === "number") {
      await new Promise((r) => setTimeout(r, found.delayMs as number));
    }
    const { delayMs: _delay, ...reply } = found ?? {};
    if (!found) {
      return new Response(JSON.stringify({ code: "not_found", message: key }), { status: 404 });
    }
    if (typeof reply.status === "number" && "json" in reply) {
      return new Response(JSON.stringify(reply.json), { status: reply.status });
    }
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return log;
}

const originalFetch = globalThis.fetch;
let root: Root | null = null;
export let container: HTMLElement;

export async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export async function render(element: ReactElement) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const r = root;
  await act(async () => r.render(<I18nProvider initialLocale="ko">{element}</I18nProvider>));
  await flush();
}

export async function cleanup() {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
    container.remove();
  }
  globalThis.fetch = originalFetch;
}

export function $(sel: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(sel);
  assert.ok(el, `selector ${sel}`);
  return el;
}

export async function click(sel: string) {
  const el = $(sel);
  await act(async () => el.click());
  await flush();
}

/** React 가 듣는 input 이벤트로 값을 바꾼다(제어 컴포넌트는 value setter 를 우회해야 한다). */
export async function type(sel: string, value: string) {
  const el = $(sel) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

export const text = () => container.textContent ?? "";
