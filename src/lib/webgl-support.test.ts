import assert from "node:assert/strict";
import test from "node:test";

import { detectWebglSupport, type WebglProbeDocument } from "./webgl-support";

function docWith(getContext: (contextId: string) => unknown): WebglProbeDocument {
  return { createElement: () => ({ getContext }) };
}

test("webgl2 컨텍스트가 나오면 지원으로 본다", () => {
  const asked: string[] = [];
  const supported = detectWebglSupport(
    docWith((contextId) => {
      asked.push(contextId);
      return {};
    }),
  );
  assert.equal(supported, true);
  assert.deepEqual(asked, ["webgl2"]);
});

test("webgl2 가 없어도 webgl 이 있으면 지원으로 본다", () => {
  const supported = detectWebglSupport(docWith((contextId) => (contextId === "webgl" ? {} : null)));
  assert.equal(supported, true);
});

test("모든 컨텍스트가 null 이면 미지원이다", () => {
  assert.equal(detectWebglSupport(docWith(() => null)), false);
});

test("getContext 가 예외를 던져도 미지원으로 떨어진다", () => {
  assert.equal(
    detectWebglSupport(
      docWith(() => {
        throw new Error("context creation failed");
      }),
    ),
    false,
  );
});

test("createElement 가 예외를 던져도 미지원으로 떨어진다", () => {
  const doc = {
    createElement() {
      throw new Error("no document");
    },
  } as unknown as WebglProbeDocument;
  assert.equal(detectWebglSupport(doc), false);
});

test("document 가 없으면(서버 렌더) 미지원이다", () => {
  assert.equal(detectWebglSupport(null), false);
  assert.equal(detectWebglSupport(undefined), false);
});
