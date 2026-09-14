import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as T from "three";

test("renderer pauses every clock, resumes without catch-up, rebuilds context and cleans up once", async () => {
  const callbacks = new Map<number, (time: number) => void>();
  let next = 0,
    effect!: () => () => void,
    renders = 0,
    environments = 0,
    disposedEnvironments = 0;
  let resize!: () => void, intersect!: (entries: { isIntersecting: boolean }[]) => void;
  let width = 1000;
  const events = new Map<string, () => void>();
  const canvasEvents = new Map<string, (event: Event) => void>();
  const updates: [number, boolean][] = [];
  const qualities: string[] = [];
  let cityDisposed = 0,
    rendererDisposed = 0;
  let settle!: () => void;
  const ready = new Promise<void>((r) => {
    settle = r;
  });
  const host = {
    dataset: {} as Record<string, string>,
    append() {},
    getBoundingClientRect: () => ({ width, height: 800 }),
  };
  const media = {
    matches: false,
    addEventListener: (_: string, cb: () => void) => events.set("motion", cb),
    removeEventListener() {},
  };
  const document = {
    hidden: false,
    documentElement: { addEventListener() {}, removeEventListener() {} },
    addEventListener: (name: string, cb: () => void) => events.set(name, cb),
    removeEventListener() {},
  };
  const renderer = {
    domElement: {
      addEventListener: (name: string, cb: (event: Event) => void) => canvasEvents.set(name, cb),
      removeEventListener() {},
      remove() {},
    },
    shadowMap: {},
    setPixelRatio() {},
    setSize() {},
    render() {
      renders++;
    },
    dispose() {
      rendererDisposed++;
    },
    forceContextLoss() {},
  };
  const exports: { default?: () => unknown } = {};
  const source = ts.transpileModule(
    readFileSync(new URL("./CommuteCityScene.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  runInNewContext(source, {
    exports,
    document,
    window: {
      devicePixelRatio: 1,
      matchMedia: () => media,
      addEventListener() {},
      removeEventListener() {},
    },
    requestAnimationFrame: (cb: (time: number) => void) => {
      callbacks.set(++next, cb);
      return next;
    },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
    ResizeObserver: class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      constructor(cb: typeof intersect) {
        intersect = cb;
      }
      observe() {}
      disconnect() {}
    },
    require(name: string) {
      if (name === "react")
        return {
          useRef: () => ({ current: host }),
          useEffect: (cb: typeof effect) => {
            effect = cb;
          },
        };
      if (name === "react/jsx-runtime") return { jsx: () => null };
      if (name === "three")
        return {
          ...T,
          WebGLRenderer: class {
            constructor() {
              return renderer;
            }
          },
          PMREMGenerator: class {
            fromScene() {
              environments++;
              return {
                texture: new T.Texture(),
                dispose() {
                  disposedEnvironments++;
                },
              };
            }
            dispose() {}
          },
        };
      if (name.includes("RoomEnvironment"))
        return {
          RoomEnvironment: class {
            dispose() {}
          },
        };
      if (name.includes("commute-city"))
        return {
          createCommuteCity: () => ({
            root: new T.Group(),
            ready,
            update: (time: number, moving: boolean) => updates.push([time, moving]),
            setQuality: (quality: string) => qualities.push(quality),
            dispose() {
              cityDisposed++;
            },
          }),
        };
      throw new Error(name);
    },
  });
  exports.default!();
  const cleanup = effect();
  const tick = (time: number) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const cb of pending) cb(time);
  };
  tick(1000);
  tick(1016);
  assert.equal(updates.at(-1)?.[0], 0.016);
  media.matches = true;
  events.get("motion")!();
  tick(2000);
  assert.equal(callbacks.size, 0);
  assert.deepEqual(updates.at(-1), [0.016, false]);
  media.matches = false;
  events.get("motion")!();
  tick(9000);
  assert.equal(updates.at(-1)?.[0], 0.016);
  document.hidden = true;
  events.get("visibilitychange")!();
  assert.equal(callbacks.size, 0);
  document.hidden = false;
  events.get("visibilitychange")!();
  tick(20000);
  assert.equal(updates.at(-1)?.[0], 0.016);
  intersect([{ isIntersecting: false }]);
  assert.equal(callbacks.size, 0);
  intersect([{ isIntersecting: true }]);
  tick(30000);
  assert.equal(updates.at(-1)?.[0], 0.016);
  width = 390;
  resize();
  tick(31000);
  assert.deepEqual(qualities, ["light"]);
  canvasEvents.get("webglcontextlost")!({ preventDefault() {} } as Event);
  assert.equal(callbacks.size, 0);
  canvasEvents.get("webglcontextrestored")!({} as Event);
  tick(60000);
  assert.equal(environments, 2);
  assert.equal(disposedEnvironments, 1);
  assert.equal(updates.at(-1)?.[0], 0.016);
  cleanup();
  settle();
  await ready;
  await Promise.resolve();
  assert.equal(callbacks.size, 0);
  assert.equal(cityDisposed, 1);
  assert.equal(rendererDisposed, 1);
  assert.equal(disposedEnvironments, 2);
  assert.ok(renders > 0);
});
