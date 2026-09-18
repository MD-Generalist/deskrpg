/**
 * `.test.tsx` 가 이 모듈을 **가장 먼저** import 한다. `@testing-library/react` 는
 * 로드 시점에 전역 `document` 를 요구하므로, 순서가 어긋나면 import 단계에서 터진다.
 *
 * 러너는 `tsx --test` 라 별도 환경(jsdom 프리셋 같은 것)이 없다. happy-dom 의 창을
 * 여기서 직접 전역에 심는다.
 */
import Module from "node:module";
import { Window } from "happy-dom";

// 화면 컴포넌트가 모듈 스코프에서 `import "*.css"` 를 부수효과로 쓴다(예: lookbook.css).
// `tsx --test` 에는 번들러가 없어 CSS 를 JS 로 파싱하려다 구문 오류로 죽는다 — 테스트에는
// 스타일이 필요 없으므로 빈 모듈로 취급한다.
(
  Module as unknown as { _extensions: Record<string, (m: unknown, filename: string) => void> }
)._extensions[".css"] = (m) => {
  (m as { exports: unknown }).exports = {};
};

const win = new Window({ url: "https://localhost/" });

const g = globalThis as unknown as Record<string, unknown>;

// Node 22 는 `navigator` 를 getter 로만 노출한다 — 단순 대입은 TypeError 다.
// 전부 defineProperty 로 심어 그 부류를 한 번에 피한다.
function install(key: string, value: unknown) {
  Object.defineProperty(g, key, { value, writable: true, configurable: true });
}

for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  // CodeMirror(ArtifactEditor)가 요구한다 — happy-dom 은 만들어 두지만 기본으로
  // 전역에 심지는 않는다.
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "Range",
  "Selection",
  "DocumentFragment",
  "Text",
]) {
  install(key, (win as unknown as Record<string, unknown>)[key]);
}
install("window", win);
// `next/link` 는 모듈 안에서 `self` 를 읽는다 — 없으면 Link 를 그리는 화면이
// "self is not defined" 로 렌더 단계에서 통째로 터진다(마법사 ④ 배치에서 실측).
install("self", g);

// React 19 는 act() 환경을 이 플래그로 판별한다. 없으면 상태 갱신마다 경고가 쏟아진다.
install("IS_REACT_ACT_ENVIRONMENT", true);
