import "../../test-setup/dom";

import assert from "node:assert/strict";
import test from "node:test";

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import MentionEditor, { type MentionEditorHandle } from "./MentionEditor";

const candidates = [
  { id: "a", name: "소피" },
  { id: "b", name: "올리버" },
  { id: "c", name: "소라" },
];

async function mount(node: React.ReactElement): Promise<{ root: Root; el: HTMLElement }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(node);
  });
  return { root, el };
}

function editor(el: HTMLElement): HTMLElement {
  const e = el.querySelector('[contenteditable="true"]');
  assert.ok(e, "contenteditable 편집기가 없다");
  return e as HTMLElement;
}

/** 사용자가 타이핑한 것처럼: 텍스트 노드를 붙이고 input 이벤트를 쏜다(캐럿은 끝으로 간주). */
async function typeText(ed: HTMLElement, text: string) {
  await act(async () => {
    ed.appendChild(document.createTextNode(text));
    ed.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function keydown(ed: HTMLElement, key: string) {
  await act(async () => {
    ed.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function items(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? "");
}

test("@ 뒤 글자로 후보를 걸러 드롭다운에 보여 준다", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor candidates={candidates} value="" onChange={() => {}} onSubmit={() => {}} />
    </I18nProvider>,
  );
  await typeText(editor(el), "안녕 @소");
  assert.deepEqual(items(el), ["소피", "소라"]);
});

test("후보를 클릭하면 @쿼리가 칩으로 바뀌고 직렬화 값이 @[이름] 이 된다", async () => {
  let value = "";
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        candidates={candidates}
        value=""
        onChange={(v) => (value = v)}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "@소");
  await act(async () => {
    (el.querySelector('[role="option"]') as HTMLElement).click();
  });
  const chip = ed.querySelector("[data-mention-id]");
  assert.ok(chip, "칩이 없다");
  assert.equal(chip?.getAttribute("data-mention-id"), "a");
  assert.equal(chip?.getAttribute("contenteditable"), "false");
  const plain = [...ed.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("");
  assert.equal(plain.includes("@"), false, "@쿼리 텍스트가 남아 있다");
  assert.equal(value, "@[소피] ");
  assert.equal(items(el).length, 0, "선택 후 드롭다운이 닫혀야 한다");
});

test("드롭다운이 닫혀 있을 때 Enter 는 제출, 열려 있을 때 Enter 는 선택", async () => {
  const sent: string[] = [];
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        candidates={candidates}
        value=""
        onChange={() => {}}
        onSubmit={() => sent.push("x")}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "@올");
  await keydown(ed, "Enter");
  assert.equal(sent.length, 0, "드롭다운이 열려 있으면 Enter 는 전송이 아니다");
  assert.equal(ed.querySelector("[data-mention-id]")?.getAttribute("data-mention-id"), "b");
  await keydown(ed, "Enter");
  assert.equal(sent.length, 1);
});

test("clear() 는 편집기를 비운다", async () => {
  const ref = createRef<MentionEditorHandle>();
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        ref={ref}
        candidates={candidates}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "hello");
  await act(async () => ref.current?.clear());
  assert.equal(ed.textContent, "");
});
