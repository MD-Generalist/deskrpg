export interface FrameMetrics {
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  assetsReady: boolean;
  actorCount: number;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  mapKey: string;
  loadedSceneBytes?: number | null;
  sceneAssets?: number;
  failedAssets?: number;
}
export interface BenchmarkReport {
  status: "complete" | "invalid";
  reason?: string;
  warmupMs: number;
  captureMs: number;
  frameCount: number;
  medianFps: number | null;
  averageFps: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  pixelRatioMin: number | null;
  pixelRatioMax: number | null;
  drawCallsMax: number;
  trianglesMax: number;
  assetsReady: boolean;
  loadedSceneBytesMax: number | null;
  sceneBudget: SceneBudgetResult;
  start: FrameMetrics | null;
  end: FrameMetrics | null;
  intervalsMs: number[];
}
/** Exact visible frame intervals; no stall filtering or FPS clamping. Inject the clock in tests. */
export class FrameBenchmark {
  private started: number;
  private previous: number | null = null;
  private captureStarted: number | null = null;
  private intervals: number[] = [];
  private samples: FrameMetrics[] = [];
  private result: BenchmarkReport | null = null;
  constructor(
    private clock: () => number,
    readonly warmupMs = 10_000,
    readonly durationMs = 30_000,
  ) {
    this.started = clock();
  }
  invalidate(reason: string): BenchmarkReport {
    return this.result ?? this.finish("invalid", reason);
  }
  frame(metrics: FrameMetrics, visible: boolean): BenchmarkReport | null {
    if (this.result) return this.result;
    if (!visible) return this.invalidate("Document became hidden");
    if (!metrics.assetsReady) return this.invalidate("Actor assets or map are not ready");
    const time = this.clock();
    const first = this.samples[0];
    if (
      first &&
      (first.mapKey !== metrics.mapKey ||
        first.viewport.width !== metrics.viewport.width ||
        first.viewport.height !== metrics.viewport.height ||
        first.devicePixelRatio !== metrics.devicePixelRatio)
    )
      return this.invalidate("Map, viewport or device pixel ratio changed during capture");
    if (time - this.started < this.warmupMs) return null;
    if (this.captureStarted === null) this.captureStarted = time;
    if (this.previous !== null) this.intervals.push(time - this.previous);
    this.previous = time;
    this.samples.push(metrics);
    return time - this.captureStarted >= this.durationMs ? this.finish("complete") : null;
  }
  private finish(status: BenchmarkReport["status"], reason?: string): BenchmarkReport {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const quantile = (p: number) =>
      sorted.length ? sorted[Math.ceil((sorted.length - 1) * p)] : null;
    const median = quantile(0.5);
    const captureMs = this.intervals.reduce((sum, value) => sum + value, 0);
    const ratios = this.samples.map((sample) => sample.pixelRatio);
    this.result = {
      status,
      ...(reason ? { reason } : {}),
      warmupMs: this.warmupMs,
      captureMs,
      frameCount: this.intervals.length,
      medianFps: median && median > 0 ? 1000 / median : null,
      averageFps: captureMs > 0 ? (1000 * this.intervals.length) / captureMs : null,
      p95FrameMs: quantile(0.95),
      maxFrameMs: quantile(1),
      pixelRatioMin: ratios.length ? Math.min(...ratios) : null,
      pixelRatioMax: ratios.length ? Math.max(...ratios) : null,
      drawCallsMax: Math.max(0, ...this.samples.map((sample) => sample.drawCalls)),
      trianglesMax: Math.max(0, ...this.samples.map((sample) => sample.triangles)),
      assetsReady: this.samples.length > 0 && this.samples.every((sample) => sample.assetsReady),
      loadedSceneBytesMax:
        this.samples.length &&
        this.samples.every((s) => s.loadedSceneBytes !== undefined && s.loadedSceneBytes !== null)
          ? Math.max(...this.samples.map((s) => s.loadedSceneBytes!))
          : null,
      sceneBudget: evaluateSceneBudget({
        triangles: Math.max(0, ...this.samples.map((s) => s.triangles)),
        drawCalls: Math.max(0, ...this.samples.map((s) => s.drawCalls)),
        loadedSceneBytes: this.samples.at(-1)?.loadedSceneBytes ?? null,
        medianFps: median && median > 0 ? 1000 / median : null,
        p95FrameMs: quantile(0.95),
      }),
      start: this.samples[0] ?? null,
      end: this.samples.at(-1) ?? null,
      intervalsMs: [...this.intervals],
    };
    return this.result;
  }
}

export type SceneBudgetResult = {
  status: "pass" | "fail" | "incomplete";
  failures: string[];
  missing: string[];
};
/** Missing measurements are explicit; an unloaded scene never earns a budget pass. */
export function evaluateSceneBudget(values: {
  triangles: number;
  drawCalls: number;
  loadedSceneBytes: number | null;
  medianFps: number | null;
  p95FrameMs: number | null;
}): SceneBudgetResult {
  const failures: string[] = [],
    missing: string[] = [];
  const check = (name: string, value: number | null, valid: (v: number) => boolean) => {
    if (value === null || !Number.isFinite(value)) missing.push(name);
    else if (!valid(value)) failures.push(name);
  };
  check("triangles", values.triangles, (v) => v <= 1_200_000);
  check("drawCalls", values.drawCalls, (v) => v <= 350);
  check("loadedSceneBytes", values.loadedSceneBytes, (v) => v < 25_000_000);
  check("medianFps", values.medianFps, (v) => v >= 55);
  check("p95FrameMs", values.p95FrameMs, (v) => v < 25);
  return {
    status: failures.length ? "fail" : missing.length ? "incomplete" : "pass",
    failures,
    missing,
  };
}
/** Compressed response bodies, once per URL; cache hits cannot erase a measured transfer. */
export function sceneTransferBytes(
  entries: readonly { name: string; encodedBodySize?: number }[],
  urls: readonly string[],
): number | null {
  const sizes = new Map<string, number>();
  for (const entry of entries) {
    let path: string;
    try {
      path = new URL(entry.name, "http://local").pathname;
    } catch {
      continue;
    }
    sizes.set(path, Math.max(sizes.get(path) ?? 0, entry.encodedBodySize ?? 0));
  }
  let total = 0;
  for (const url of new Set(urls)) {
    const size = sizes.get(url);
    if (!size) return null;
    total += size;
  }
  return total;
}
