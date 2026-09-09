/**
 * `.test.tsx` 가 이 모듈을 **가장 먼저** import 한다. `@testing-library/react` 는
 * 로드 시점에 전역 `document` 를 요구하므로, 순서가 어긋나면 import 단계에서 터진다.
 *
 * 러너는 `tsx --test` 라 별도 환경(jsdom 프리셋 같은 것)이 없다. happy-dom 의 창을
 * 여기서 직접 전역에 심는다.
 */
import { Window } from "happy-dom";

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
]) {
  install(key, (win as unknown as Record<string, unknown>)[key]);
}
install("window", win);

// React 19 는 act() 환경을 이 플래그로 판별한다. 없으면 상태 갱신마다 경고가 쏟아진다.
install("IS_REACT_ACT_ENVIRONMENT", true);
