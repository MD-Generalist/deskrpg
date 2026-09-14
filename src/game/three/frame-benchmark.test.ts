import test from "node:test";
import assert from "node:assert/strict";
import { FrameBenchmark, type FrameMetrics } from "./frame-benchmark";
const metrics: FrameMetrics = {
  pixelRatio: 1.75,
  drawCalls: 400,
  triangles: 600_000,
  geometries: 200,
  textures: 40,
  assetsReady: true,
  actorCount: 12,
  viewport: { width: 1280, height: 720 },
  devicePixelRatio: 2,
  mapKey: "publishing:0",
};

test("waits 10 seconds and captures 30 seconds, including a visible 900ms stall", () => {
  let time = 0;
  const benchmark = new FrameBenchmark(() => time);
  for (time = 0; time < 10_000; time += 100) assert.equal(benchmark.frame(metrics, true), null);
  assert.equal(benchmark.frame(metrics, true), null);
  let report = null;
  for (let i = 0; !report; i++) {
    time += i === 10 ? 900 : 100;
    report = benchmark.frame(
      { ...metrics, pixelRatio: i > 100 ? 1.25 : 1.75, drawCalls: i === 10 ? 650 : 400 },
      true,
    );
  }
  assert.equal(report.status, "complete");
  assert.equal(report.warmupMs, 10_000);
  assert.equal(report.captureMs, 30_000);
  assert.equal(report.frameCount, 292);
  assert.equal(report.maxFrameMs, 900);
  assert.equal(report.intervalsMs.filter((interval) => interval === 900).length, 1);
  assert.equal(report.p95FrameMs, 100);
  assert.equal(report.medianFps, 10);
  assert.ok(report.averageFps! < 10);
  assert.equal(report.pixelRatioMin, 1.25);
  assert.equal(report.pixelRatioMax, 1.75);
  assert.equal(report.drawCallsMax, 650);
  assert.deepEqual(report.start?.viewport, metrics.viewport);
});

test("hidden tabs invalidate warmup and capture instead of silently dropping time", () => {
  let time = 0;
  const warming = new FrameBenchmark(() => time);
  assert.equal(warming.frame(metrics, false)?.status, "invalid");
  const benchmark = new FrameBenchmark(() => time, 0, 100);
  benchmark.frame(metrics, true);
  time = 50;
  benchmark.frame(metrics, true);
  const result = benchmark.frame(metrics, false)!;
  assert.equal(result.status, "invalid");
  assert.match(result.reason!, /hidden/);
  time = 200;
  assert.deepEqual(
    benchmark.frame(metrics, true),
    result,
    "visibility cannot resume an invalid run",
  );
});

test("hidden visibility events invalidate even while RAF is suspended", () => {
  const benchmark = new FrameBenchmark(() => 0);
  const result = benchmark.invalidate("Document became hidden");
  assert.equal(result.frameCount, 0);
  assert.equal(result.medianFps, null);
  assert.equal(result.assetsReady, false);
  assert.equal(result.status, "invalid");
});

test("asset failure, map swap or viewport/DPR changes invalidate the sample", () => {
  for (const changed of [
    { assetsReady: false },
    { mapKey: "tech:1" },
    { viewport: { width: 1024, height: 720 } },
    { devicePixelRatio: 1 },
  ]) {
    let time = 0;
    const benchmark = new FrameBenchmark(() => time, 0, 100);
    benchmark.frame(metrics, true);
    time = 50;
    assert.equal(benchmark.frame({ ...metrics, ...changed }, true)?.status, "invalid");
  }
});

test("studio scene budgets report every threshold and never pass unknown transfer or frame data", async () => {
  const { evaluateSceneBudget, sceneTransferBytes } = await import("./frame-benchmark");
  const good = {
    triangles: 1_200_000,
    drawCalls: 350,
    loadedSceneBytes: 24_999_999,
    medianFps: 55,
    p95FrameMs: 24.9,
  };
  assert.equal(evaluateSceneBudget(good).status, "pass");
  const bad = evaluateSceneBudget({
    ...good,
    triangles: 1_200_001,
    drawCalls: 351,
    loadedSceneBytes: 25_000_001,
    medianFps: 54,
    p95FrameMs: 25.1,
  });
  assert.equal(bad.status, "fail");
  assert.equal(bad.failures.length, 5);
  assert.equal(evaluateSceneBudget({ ...good, loadedSceneBytes: null }).status, "incomplete");
  assert.equal(
    sceneTransferBytes(
      [
        { name: "https://test/assets/a.glb", encodedBodySize: 120 },
        { name: "https://test/assets/a.glb", encodedBodySize: 0 },
      ],
      ["/assets/a.glb"],
    ),
    120,
  );
  assert.equal(sceneTransferBytes([], ["/assets/a.glb"]), null);
});
