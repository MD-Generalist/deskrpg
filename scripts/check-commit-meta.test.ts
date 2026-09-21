import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const SCRIPT = path.join(process.cwd(), "scripts/check-commit-meta.sh");

function check(message: string) {
  const r = spawnSync("bash", [SCRIPT], { input: message, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

test("세션 트레일러·보드 식별자·비공개 문서 경로가 든 메시지는 막는다", () => {
  for (const bad of [
    "fix: x\n\nClaude-Session: https://claude.ai/code/session_01AbC",
    "fix: x\n\n카드: PVTI_lAHOB6eLEc4BjrHnzg70RxQ",
    "fix: x\n\nStage 필드 PVTSSF_lAHOB6eLEc4BjrHnzhiiz9U",
    "fix: x\n\n드래프트 DI_lAHOB6eLEc4BjrHnzgLJ8c8",
    "feat: y\n\n스펙: docs/superpowers/specs/2026-09-21-x-design.md",
    "feat: y\n\ndocs/standards.md 의 규칙을 따른다",
    "feat: y\n\n(docs/engineering-notes.md 참고)",
    "chore: z\n\n.superpowers/sdd/progress.md",
  ]) {
    const r = check(bad);
    assert.equal(r.status, 1, `막지 않았다: ${bad}`);
    assert.match(r.stderr, /개발 메타/);
  }
});

test("평범한 메시지와 비슷하지만 다른 표현은 통과한다", () => {
  for (const ok of [
    "docs: README 의 Docker 안내를 고친다",
    "fix(ui): 크림 배경 위 옅은 팔레트 글자색 31곳\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
    "feat(app): src/app/docs/page.tsx 를 더한다",
    "fix: PVT 약어 설명",
  ]) {
    const r = check(ok);
    assert.equal(r.status, 0, `잘못 막았다: ${ok}\n${r.stderr}`);
  }
});

test("git 이 붙이는 주석 줄(#)은 검사하지 않는다", () => {
  // 편집기로 커밋할 때 git 은 변경 파일 목록을 # 주석으로 붙인다 — 거기에 docs/ 가 나올 수 있다.
  assert.equal(check("fix: x\n\n# Changes to be committed:\n#\tmodified: docs/a.md\n").status, 0);
});
