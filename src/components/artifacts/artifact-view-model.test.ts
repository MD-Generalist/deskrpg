import test from "node:test";
import assert from "node:assert/strict";
import {
  viewerFor,
  isEditable,
  hasRenderedMode,
  codeLanguageFor,
  safeHttpUrl,
  parseCsv,
  sourceTarget,
  brandIconFor,
  categoryOf,
} from "./artifact-view-model";

const a = (kind: string, mime: string, filename: string) => ({ kind, mime, filename }) as never;

test("뷰어는 kind·mime·확장자로 고른다", () => {
  assert.equal(viewerFor(a("document", "text/markdown", "r.md")), "markdown");
  assert.equal(viewerFor(a("document", "text/plain", "r.txt")), "text");
  assert.equal(viewerFor(a("document", "application/pdf", "r.pdf")), "pdf");
  assert.equal(
    viewerFor(
      a(
        "document",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "r.docx",
      ),
    ),
    "download",
  );
  assert.equal(viewerFor(a("image", "image/png", "a.png")), "image");
  assert.equal(viewerFor(a("image", "image/svg+xml", "a.svg")), "svg");
  assert.equal(viewerFor(a("media", "audio/mpeg", "a.mp3")), "audio");
  assert.equal(viewerFor(a("media", "video/mp4", "a.mp4")), "video");
  assert.equal(viewerFor(a("web", "text/html", "a.html")), "html");
  assert.equal(viewerFor(a("react", "text/plain", "App.tsx")), "code");
  assert.equal(viewerFor(a("data", "text/csv", "a.csv")), "csv");
  assert.equal(viewerFor(a("data", "application/json", "a.json")), "code");
  assert.equal(viewerFor(a("link", "text/uri-list", "a.url")), "link");
  assert.equal(viewerFor(a("file", "application/zip", "a.zip")), "download");
  assert.equal(viewerFor(a("file", "text/x-python", "a.py")), "code");
});

test("편집은 텍스트 계열만", () => {
  assert.equal(isEditable(a("document", "text/markdown", "r.md")), true);
  assert.equal(isEditable(a("link", "text/uri-list", "a.url")), true);
  assert.equal(isEditable(a("web", "text/html", "a.html")), true);
  assert.equal(isEditable(a("image", "image/png", "a.png")), false);
  assert.equal(isEditable(a("image", "image/svg+xml", "a.svg")), false);
  assert.equal(isEditable(a("document", "application/pdf", "r.pdf")), false);
  assert.equal(isEditable(a("file", "application/zip", "a.zip")), false);
});

test("렌더/소스 전환은 markdown·svg·html 만", () => {
  assert.deepEqual(
    ["markdown", "svg", "html", "code", "pdf"].map((v) => hasRenderedMode(v as never)),
    [true, true, true, false, false],
  );
});

test("코드 언어", () => {
  assert.equal(codeLanguageFor("App.tsx"), "tsx");
  assert.equal(codeLanguageFor("a.py"), "python");
  assert.equal(codeLanguageFor("a.json"), "json");
  assert.equal(codeLanguageFor("a.unknownext"), "text");
});

test("링크 재검증은 첫 줄 http(s) 만", () => {
  assert.equal(safeHttpUrl("https://x.io/a\n"), "https://x.io/a");
  assert.equal(safeHttpUrl("  http://x.io  "), "http://x.io/");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,x"), null);
  assert.equal(safeHttpUrl(""), null);
});

test("CSV 는 따옴표·이스케이프·줄바꿈을 처리하고 행 상한에서 자른다", () => {
  const { rows } = parseCsv('a,b\n"x, y","he said ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x, y", 'he said "hi"'],
    ["multi\nline", "2"],
  ]);
  const big = parseCsv(Array.from({ length: 5 }, (_, i) => `${i}`).join("\n"), 3);
  assert.equal(big.rows.length, 3);
  assert.equal(big.truncated, true);
});

test("출처로 이동 대상", () => {
  assert.deepEqual(sourceTarget({ source_kind: "kanban", task_id: "t1", profile: "p" } as never), {
    type: "kanban",
    taskId: "t1",
  });
  assert.deepEqual(sourceTarget({ source_kind: "chat", profile: "p" } as never), {
    type: "chat",
    profile: "p",
  });
  assert.deepEqual(sourceTarget({ source_kind: "cron", job_id: "j1", profile: "p" } as never), {
    type: "cron",
    jobId: "j1",
    profile: "p",
  });
});

test("브랜드 아이콘은 호스트 이름으로만 고른다", () => {
  assert.equal(brandIconFor("https://github.com/a/b"), "github");
  assert.equal(brandIconFor("https://www.youtube.com/watch?v=1"), "youtube");
  assert.equal(brandIconFor("https://example.com"), null);
});

test("categoryOf 는 kind 를 미디어·파일·링크 세 카테고리로 묶는다", () => {
  assert.equal(categoryOf("image"), "media");
  assert.equal(categoryOf("media"), "media");
  assert.equal(categoryOf("document"), "file");
  assert.equal(categoryOf("web"), "file");
  assert.equal(categoryOf("react"), "file");
  assert.equal(categoryOf("data"), "file");
  assert.equal(categoryOf("file"), "file");
  assert.equal(categoryOf("link"), "link");
});
