/**
 * 3D 오피스를 띄울 수 있는 브라우저인지 판정한다.
 *
 * 2D 폴백이 사라진 뒤로 WebGL 이 없으면 채널 화면 자체가 의미가 없다 — 그래서
 * 소켓을 열기 전에 먼저 이 검사를 통과해야 한다. 브라우저 API 를 주입받는 순수
 * 함수로 두어 테스트에서 컨텍스트 반환·`null`·예외 세 경우를 모두 재현한다.
 */

/** 검사에 필요한 캔버스의 최소 형태. */
export interface WebglProbeCanvas {
  getContext(contextId: string): unknown;
}

/** 검사에 필요한 문서의 최소 형태(`document` 가 그대로 들어맞는다). */
export interface WebglProbeDocument {
  createElement(tagName: "canvas"): WebglProbeCanvas;
}

/** 이 순서로 시도한다 — webgl2 가 없어도 webgl 만 있으면 three.js 는 돈다. */
const CONTEXT_IDS = ["webgl2", "webgl"] as const;

export function detectWebglSupport(doc: WebglProbeDocument | null | undefined): boolean {
  if (!doc) return false;

  let canvas: WebglProbeCanvas;
  try {
    canvas = doc.createElement("canvas");
  } catch {
    return false;
  }
  if (!canvas || typeof canvas.getContext !== "function") return false;

  for (const contextId of CONTEXT_IDS) {
    try {
      // 하드웨어 가속이 꺼진 브라우저는 여기서 null 을 주거나 예외를 던진다 — 둘 다 실패로 본다.
      if (canvas.getContext(contextId)) return true;
    } catch {
      // 다음 컨텍스트 id 로 넘어간다.
    }
  }
  return false;
}
