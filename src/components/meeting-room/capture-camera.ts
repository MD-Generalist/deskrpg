/** Capture-only pointer parallax. Normal development and production stay fixed. */
export function meetingCaptureOffset(
  x: number,
  y: number,
  nodeEnv: string | undefined,
  captureFlag: string | undefined,
): { yaw: number; lift: number } {
  if (nodeEnv !== "development" || captureFlag !== "1") return { yaw: 0, lift: 0 };
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return { yaw: clamp(x) * 0.14, lift: clamp(y) * 0.025 };
}
