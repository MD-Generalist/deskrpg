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
      start: this.samples[0] ?? null,
      end: this.samples.at(-1) ?? null,
      intervalsMs: [...this.intervals],
    };
    return this.result;
  }
}
