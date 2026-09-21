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

/**
 * 크림 surface(#fcfcf8) 위에서 600 이하 음영의 팔레트 글자색은 AA(4.5:1)를 넘지 못한다.
 * 실측: text-amber-300 1.40:1, text-emerald-300 1.48:1, text-red-400 2.69:1,
 * text-amber-600 3.10:1, text-red-500 3.71:1, text-red-600 4.63:1(경계).
 * 자기 배경을 옅게 깐 배지도 마찬가지다 — bg-amber-500/15 위 text-amber-700 은 4.38:1.
 * 의미색 토큰(text-danger·text-success·text-info·text-npc-dark)을 쓴다.
 *
 * 700 이상은 대비로는 통과하므로(4.55~8.77:1) 이 검사가 막지 않는다. 다만 제품 고유색
 * 하나 원칙(docs/standards.md)에는 여전히 어긋나서 10곳이 남아 있고, 별 카드로 다룬다.
 */
const PALE_PALETTE_TEXT =
  /\btext-(amber|indigo|emerald|sky|rose|violet|teal|red|blue|green|yellow|slate|gray|zinc|stone|neutral|orange|lime|cyan|fuchsia|pink|purple)-(50|100|200|300|400|500|600)\b/;

test("옅은 팔레트 글자색을 쓰지 않는다 — 의미색 토큰을 쓴다", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith("chat-accent.test.ts")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const bare = line.trim();
        if (bare.startsWith("*") || bare.startsWith("//") || bare.startsWith("/*")) return;
        if (PALE_PALETTE_TEXT.test(line))
          offenders.push(`${path.relative(SRC, file)}:${i + 1} ${bare}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `크림 배경 위 옅은 팔레트 글자색은 대비가 AA 에 못 미친다. 의미색 토큰으로 바꿔라 — 오류 text-danger, 성공 text-success, 정보 text-info, 경고 text-npc-dark:\n${offenders.join("\n")}`,
  );
});

/**
 * 뜻으로 읽히는 색 이름은 **정의돼 있을 때만** 쓴다. Tailwind 는 모르는 색 이름의 유틸리티를 조용히 버리므로
 * `text-warning` 은 빌드도 타입도 lint 도 통과하면서 아무 색도 내지 않는다 — 2026-09-21 에 "사용자가 조치해야
 * 한다" 를 말하려던 세 자리가 그렇게 죽어 있었다(경고는 `npc-dark` 토큰을 쓴다).
 */
const SEMANTIC_COLOR_NAMES = ["warning", "error", "caution", "alert", "positive", "negative"];

test("정의되지 않은 의미색 이름으로 유틸리티 클래스를 쓰지 않는다", () => {
  const css = ["styles/tokens.css", "app/globals.css"]
    .map((file) => readFileSync(path.join(SRC, file), "utf8"))
    .join("\n");
  const undefinedNames = SEMANTIC_COLOR_NAMES.filter((name) => !css.includes(`--color-${name}:`));
  const pattern = new RegExp(
    `\\b(text|bg|border|fill|stroke|ring|from|to|via)-(${undefinedNames.join("|")})\\b`,
  );
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith("chat-accent.test.ts")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const bare = line.trim();
        if (bare.startsWith("*") || bare.startsWith("//") || bare.startsWith("/*")) return;
        if (pattern.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1} ${bare}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `정의되지 않은 색 이름이라 아무 색도 나지 않는다. 토큰을 정의하거나 있는 토큰을 써라(경고는 text-npc-dark):\n${offenders.join("\n")}`,
  );
});
