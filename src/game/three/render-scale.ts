/** Match the office quality target, with two windows of hysteresis for transient load. */
export function adaptRenderScale(
  scale: number,
  previousSlowSamples: number,
  fps: number,
  p95Ms: number,
) {
  const slowSamples = fps < 55 || p95Ms > 25 ? previousSlowSamples + 1 : 0;
  if (slowSamples >= 2) return { scale: Math.max(0.75, scale - 0.25), slowSamples: 0 };
  return { scale, slowSamples };
}
