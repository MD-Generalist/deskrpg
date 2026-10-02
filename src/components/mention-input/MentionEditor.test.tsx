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

/** As if the user typed it: append a text node and fire an input event (the caret is assumed to be at the end). */
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

test("filters candidates by the characters after @ and shows them in the dropdown", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor candidates={candidates} value="" onChange={() => {}} onSubmit={() => {}} />
    </I18nProvider>,
  );
  await typeText(editor(el), "안녕 @소");
  assert.deepEqual(items(el), ["소피", "소라"]);
});

test("clicking a candidate turns the @query into a chip and serializes to @[name]", async () => {
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

test("Enter submits when the dropdown is closed, and selects when it's open", async () => {
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

test("clear() empties the editor", async () => {
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

test("a selected candidate is colored with a brand token, not hardcoded white text", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        candidates={[{ id: "a", name: "noah" }]}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  await typeText(editor(el), "@no");
  const option = el.querySelector('[role="option"]');
  assert.ok(option, "후보가 하나여도 드롭다운 항목이 있어야 한다");
  assert.equal(option?.getAttribute("aria-selected"), "true", "후보가 하나면 선택 상태다");
  const cls = option?.className ?? "";
  assert.equal(/\btext-white\b/.test(cls), false, `선택 항목에 text-white 가 남아 있다: ${cls}`);
  assert.ok(/\btext-text\b/.test(cls), `선택 항목 글자색이 브랜드 토큰이 아니다: ${cls}`);
  assert.equal(/-\$\{|undefined/.test(cls), false, `조립 클래스 흔적이 있다: ${cls}`);
});

test("a mention chip is colored with a brand token, with no assembled classes", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor candidates={candidates} value="" onChange={() => {}} onSubmit={() => {}} />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "@소");
  await act(async () => {
    (el.querySelector('[role="option"]') as HTMLElement).click();
  });
  const cls = ed.querySelector("[data-mention-id]")?.className ?? "";
  assert.ok(/\btext-text\b/.test(cls), `칩 글자색이 브랜드 토큰이 아니다: ${cls}`);
  assert.equal(
    /-500\/|amber|indigo/.test(cls),
    false,
    `칩에 조립 팔레트 클래스가 남아 있다: ${cls}`,
  );
});

const skills = [
  { name: "research", description: "Dig into a topic" },
  { name: "write-report", description: "Write a report" },
];

test("'/' opens the skill list and Enter turns the pick into a skill chip", async () => {
  let segments: unknown[] = [];
  let text = "x";
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        skillCandidates={skills}
        onChange={(v, segs) => {
          text = v;
          segments = segs;
        }}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "/wri");
  assert.ok(el.querySelector("[data-skill-list]"));
  assert.deepEqual(
    [...el.querySelectorAll("[data-skill-option]")].map((o) => o.getAttribute("data-skill-option")),
    ["write-report"],
  );
  await keydown(ed, "Enter");
  const chip = ed.querySelector("[data-skill-name]");
  assert.equal(chip?.getAttribute("data-skill-name"), "write-report");
  assert.equal(chip?.getAttribute("contenteditable"), "false");
  assert.ok(!el.querySelector("[data-skill-list]"), "the list closes after a pick");
  assert.equal(text.trim(), "", "a skill chip is not part of the sent text");
  assert.deepEqual(segments[0], { kind: "skill", name: "write-report" });
});

test("a skill already chosen is not offered again", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        skillCandidates={skills}
        initialSegments={[{ kind: "skill", name: "research" }]}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  await typeText(editor(el), "/");
  assert.deepEqual(
    [...el.querySelectorAll("[data-skill-option]")].map((o) => o.getAttribute("data-skill-option")),
    ["write-report"],
  );
});

test("with five chips the list gives way to the limit note", async () => {
  const many = ["a1", "a2", "a3", "a4", "a5", "a6"].map((name) => ({ name, description: "" }));
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        skillCandidates={many}
        initialSegments={many.slice(0, 5).map((s) => ({ kind: "skill" as const, name: s.name }))}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  await typeText(editor(el), "/");
  assert.equal(el.querySelector("[data-skill-note]")?.getAttribute("data-skill-note"), "limit");
  assert.ok(!el.querySelector("[data-skill-list]"));
});

test("a room without exactly one named teammate shows the single-mention note", async () => {
  const sent: string[] = [];
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        candidates={candidates}
        skillsBlockedReason="single_mention"
        onChange={() => {}}
        onSubmit={() => sent.push("x")}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  await typeText(ed, "/res");
  assert.equal(
    el.querySelector("[data-skill-note]")?.getAttribute("data-skill-note"),
    "single_mention",
  );
  assert.ok(!el.querySelector("[data-skill-list]"));
  await keydown(ed, "Enter");
  assert.equal(sent.length, 1, "a note never takes Enter");
  assert.ok(!ed.querySelector("[data-skill-name]"));
});

test("an older plugin keeps '/' a plain character and shows the update note", async () => {
  let text = "";
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        skillsBlockedReason="plugin_update"
        onChange={(v) => (text = v)}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  await typeText(editor(el), "/tmp");
  assert.equal(
    el.querySelector("[data-skill-note]")?.getAttribute("data-skill-note"),
    "plugin_update",
  );
  assert.equal(text, "/tmp");
});

test("without skill props '/' does nothing, and without candidates '@' does nothing", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor onChange={() => {}} onSubmit={() => {}} />
    </I18nProvider>,
  );
  await typeText(editor(el), "/tmp @so");
  assert.ok(!el.querySelector("[data-skill-note], [data-skill-list], [role='listbox']"));
});

test("Backspace removes a skill chip whole", async () => {
  let segments: unknown[] = [{}];
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        skillCandidates={skills}
        initialSegments={[{ kind: "skill", name: "research" }]}
        onChange={(_v, segs) => (segments = segs)}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  assert.ok(ed.querySelector("[data-skill-name]"));
  await act(async () => {
    const range = document.createRange();
    range.setStart(ed, 1);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await keydown(ed, "Backspace");
  assert.ok(!ed.querySelector("[data-skill-name]"));
  assert.deepEqual(segments, []);
});

test("the saved draft is shown with its chips when the editor mounts", async () => {
  const { el } = await mount(
    <I18nProvider>
      <MentionEditor
        candidates={candidates}
        skillCandidates={skills}
        initialSegments={[
          { kind: "mention", id: "a", name: "소피" },
          { kind: "text", text: " " },
          { kind: "skill", name: "research" },
          { kind: "text", text: " 이번 주 정리" },
        ]}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    </I18nProvider>,
  );
  const ed = editor(el);
  assert.equal(ed.querySelector("[data-mention-id]")?.getAttribute("data-mention-id"), "a");
  assert.equal(ed.querySelector("[data-skill-name]")?.textContent, "/research");
  assert.ok(ed.textContent?.endsWith(" 이번 주 정리"));
});
