import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const layoutPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "MapEditorLayout.tsx");

/**
 * "사용하지 않는 타일셋 정리" 는 리듀서(`REMOVE_UNUSED_TILESETS`)까지 끝까지
 * 구현돼 있었는데 **화면에 진입점이 없었다** — `handleCleanUpUnused` 를 참조하는
 * 곳이 선언 한 줄뿐이라 아무도 호출할 수 없었고, 사용자는 쓰지 않는 타일셋을
 * 지울 방법이 없었다(2026-09-08, lint 정리 중 발견).
 *
 * 같은 부류를 이 프로젝트에서 이미 한 번 겪었다 — 인격 편집 기능이 있는데 버튼이
 * 없어 "수정할 방법이 없어 보인다" 는 말을 들었다. 렌더 테스트로 버튼을 찾는 쪽이
 * 더 낫지만, 이 컴포넌트는 캔버스·컨텍스트 의존이 커서 마운트 비용이 크다.
 * 그래서 **호출부가 존재하는지**만 소스에서 고정한다 — 다시 고아가 되면 빨개진다.
 */
test("정리 핸들러에 화면 진입점이 있다", () => {
  const src = readFileSync(layoutPath, "utf8");
  const declarations = src.match(/const handleCleanUpUnused\b/g) ?? [];
  const references = src.match(/\bhandleCleanUpUnused\b/g) ?? [];

  assert.equal(declarations.length, 1, "핸들러 선언이 하나여야 한다");
  assert.ok(
    references.length > declarations.length,
    "handleCleanUpUnused 를 참조하는 곳이 선언뿐입니다 — 기능이 있어도 화면에서 쓸 수 없습니다",
  );
  assert.match(
    src,
    /onClick=\{handleCleanUpUnused\}/,
    "정리 버튼의 onClick 이 핸들러에 연결돼 있어야 합니다",
  );
});

test("정리 버튼은 지울 것이 있을 때만 뜬다", () => {
  const src = readFileSync(layoutPath, "utf8");
  assert.match(
    src,
    /\{unusedTilesets\.length > 0 && \(/,
    "지울 것이 없을 때도 버튼이 보이면, 눌러도 아무 일이 없어 고장으로 읽힌다",
  );
});
