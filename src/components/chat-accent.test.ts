import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { CHAT_ACCENT, accentClasses } from "./chat-accent";

const SRC = path.join(process.cwd(), "src");

/** Tailwind 팔레트를 문자열로 조립한 모양: `bg-${x}-500`, `text-${x}-200` … */
const ASSEMBLED =
  /\b(bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|divide|decoration|caret|placeholder)-\$\{[^}]+\}-/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

test("Tailwind 클래스를 문자열로 조립한 곳이 없다", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const bare = line.trim();
        // 주석은 규칙을 설명하려고 그 모양을 인용한다 — 검사 대상이 아니다.
        if (bare.startsWith("*") || bare.startsWith("//") || bare.startsWith("/*")) return;
        if (ASSEMBLED.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1} ${bare}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `조립한 Tailwind 클래스는 빌드 때 생성되지 않아 색이 조용히 사라진다. 미리 정의된 클래스 맵으로 바꿔라:\n${offenders.join("\n")}`,
  );
});

test("강조색은 크림 배경 위 흰 글자나 팔레트 이름을 쓰지 않는다", () => {
  // 채도 높은 accent 면(버튼) 위의 흰 글자는 옳다. 금지 대상은 크림 surface 위에 얹히는 슬롯이다.
  const onSurface = new Set(["option", "chip"]);
  for (const [name, classes] of Object.entries(CHAT_ACCENT)) {
    for (const [slot, value] of Object.entries(classes)) {
      if (onSurface.has(slot)) {
        assert.equal(
          /\btext-white\b/.test(value),
          false,
          `${name}.${slot} 은 크림 surface 위에 얹히는데 text-white 를 쓴다(대비 1.03:1)`,
        );
        assert.ok(/\btext-text\b/.test(value), `${name}.${slot} 글자색이 본문 토큰이 아니다`);
      }
      assert.equal(
        /\b(amber|indigo|slate|gray|zinc)-\d/.test(value),
        false,
        `${name}.${slot} 이 브랜드 토큰이 아닌 팔레트를 쓴다: ${value}`,
      );
    }
  }
});

test("모르는 강조색은 기본값으로 떨어진다", () => {
  assert.equal(accentClasses(), CHAT_ACCENT.npc);
  assert.equal(accentClasses("meeting"), CHAT_ACCENT.meeting);
  // 런타임에 엉뚱한 값이 와도 클래스가 undefined 가 되지 않는다.
  assert.equal(accentClasses("nope" as never), CHAT_ACCENT.npc);
});
