// 본문용 글자 토큰은 웹 화면의 세 면(bg·surface·surface-raised) 위에서 WCAG AA(4.5:1)를 지킨다.
// 토큰 값을 바꾸면 그 토큰을 쓰는 화면 수십 곳의 대비가 한 번에 바뀐다 — 값에서 막는다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const css = ["src/styles/tokens.css", "src/styles/theme-web.css"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `--${name} 을 6자리 hex 로 찾지 못했다`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("글자 토큰은 웹 화면의 면 위에서 4.5:1 이상이다", () => {
  for (const text of ["text", "text-secondary", "text-muted"])
    for (const surface of ["bg", "surface", "surface-raised"]) {
      const ratio = contrast(token(text), token(surface));
      assert.ok(ratio >= 4.5, `--${text} on --${surface}: ${ratio.toFixed(2)}:1`);
    }
});

test("가장 옅은 글자(text-dim)도 읽는 면(bg·surface) 위에서는 4.5:1 이상이다", () => {
  // 가라앉은 면(surface-raised) 위에서 4.5:1 을 넘기려면 text-muted 와 같은 값이 돼 위계가 사라진다.
  // 그 면 위의 글자에는 text-dim 을 쓰지 않는다 — text-muted 이상을 쓴다.
  for (const surface of ["bg", "surface"]) {
    const ratio = contrast(token("text-dim"), token(surface));
    assert.ok(ratio >= 4.5, `--text-dim on --${surface}: ${ratio.toFixed(2)}:1`);
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

test("가라앉은 면(bg-surface-raised) 위에 text-dim 을 얹지 않는다 — 비활성 컨트롤만 예외다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src"))
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        // hover:bg-surface-raised 는 기본 면이 아니다. 비활성 컨트롤은 대비 요건의 예외다.
        const onRaised = /(^|[\s"'`])bg-surface-raised/.test(line);
        const disabled = /cursor-not-allowed|disabled:/.test(line);
        if (onRaised && /text-text-dim/.test(line) && !disabled)
          offenders.push(`${file}:${index + 1}`);
      });
  assert.deepEqual(offenders, []);
});
